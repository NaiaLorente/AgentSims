import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ActiveConversation, AffinityPoint, Agent, LogEntry, ModelStats, Proposal, SimClock, World, Zone } from '../sim/types';
import { buildWorld } from '../sim/world';
import { createZones } from '../sim/zones';
import { agentIdCounter } from '../sim/ids';
import {
  type AgentConfig,
  createAgentFromConfig,
  createAgentsFromConfigs,
  defaultAgentConfigs,
  defaultLabelForIndex,
  makeAgentConfigId,
} from '../sim/agents';

let logCounter = 0;
export function makeLogId(): string {
  logCounter += 1;
  return `log_${Date.now().toString(36)}_${logCounter}`;
}

export type ConnectionStatus = 'unknown' | 'checking' | 'ok' | 'error';

export interface ConnectionSettings {
  baseUrl: string;
  temperature: number;
}

const DEFAULT_CONNECTION_SETTINGS: ConnectionSettings = {
  baseUrl: 'http://localhost:11434',
  temperature: 0.8,
};

export interface SimState {
  world: World;
  agents: Record<string, Agent>;
  agentOrder: string[];
  agentConfigs: AgentConfig[];
  /** Fixed places on the map — static, not something agents create or discover. */
  zones: Zone[];
  /** Conversations currently in flight, keyed by id — transient, not persisted across save/load. */
  activeConversations: Record<string, ActiveConversation>;
  /** Cumulative per-model stats for the comparison dashboard, keyed by model name. */
  modelStats: Record<string, ModelStats>;
  /** Affinity-over-time history for the relationship trend sparklines, capped and append-only. */
  affinityHistory: AffinityPoint[];
  /** Self-governance banishment proposals, open and resolved — town-wide, not per-agent. */
  proposals: Proposal[];
  log: LogEntry[];
  clock: SimClock;
  settings: ConnectionSettings;
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  availableModels: string[];
  selectedAgentId: string | null;

  setSettings: (partial: Partial<ConnectionSettings>) => void;
  addAgentConfig: () => void;
  removeAgentConfig: (id: string) => void;
  updateAgentConfig: (id: string, partial: Partial<AgentConfig>) => void;
  setAvailableModels: (models: string[]) => void;
  setConnectionStatus: (status: ConnectionStatus, error?: string | null) => void;
  selectAgent: (id: string | null) => void;
  play: () => void;
  pause: () => void;
  setSpeed: (ticksPerSecond: number) => void;
  pushLog: (text: string, kind: LogEntry['kind']) => void;
  reset: () => void;
  /** Escape hatch for the tick engine to apply arbitrary immer-style mutations. */
  mutate: (fn: (state: SimState) => void) => void;
}

function freshWorldAndAgents(configs: AgentConfig[]): {
  world: World;
  agents: Record<string, Agent>;
  agentOrder: string[];
} {
  const world = buildWorld();
  const agentList = createAgentsFromConfigs(configs, world);
  const agents: Record<string, Agent> = {};
  for (const a of agentList) agents[a.id] = a;
  return { world, agents, agentOrder: agentList.map((a) => a.id) };
}

function freshLog(): LogEntry[] {
  return [{ id: makeLogId(), tick: 0, text: 'The sandbox begins. No rules, no roles — just watch.', kind: 'system' }];
}

export const useSimStore = create<SimState>()(
  immer((set) => {
    const initialConfigs = defaultAgentConfigs();
    const { world, agents, agentOrder } = freshWorldAndAgents(initialConfigs);

    return {
      world,
      agents,
      agentOrder,
      agentConfigs: initialConfigs,
      zones: createZones(),
      activeConversations: {},
      modelStats: {},
      affinityHistory: [],
      proposals: [],
      log: freshLog(),
      clock: { tick: 0, running: false, ticksPerSecond: 1 },
      settings: DEFAULT_CONNECTION_SETTINGS,
      connectionStatus: 'unknown',
      connectionError: null,
      availableModels: [],
      selectedAgentId: null,

      setSettings: (partial) =>
        set((state) => {
          Object.assign(state.settings, partial);
        }),

      addAgentConfig: () =>
        set((state) => {
          const config: AgentConfig = {
            id: makeAgentConfigId(),
            label: defaultLabelForIndex(state.agentConfigs.length),
            model: '',
          };
          state.agentConfigs.push(config);
          // Spawn it live immediately — no Reset needed to see a newly added agent.
          const agent = createAgentFromConfig(config, state.world, state.agentConfigs.length - 1);
          state.agents[agent.id] = agent;
          state.agentOrder.push(agent.id);
        }),

      removeAgentConfig: (id) =>
        set((state) => {
          state.agentConfigs = state.agentConfigs.filter((c) => c.id !== id);
          delete state.agents[id];
          state.agentOrder = state.agentOrder.filter((agentId) => agentId !== id);
          if (state.selectedAgentId === id) state.selectedAgentId = null;
        }),

      updateAgentConfig: (id, partial) =>
        set((state) => {
          const cfg = state.agentConfigs.find((c) => c.id === id);
          if (cfg) Object.assign(cfg, partial);
          // Apply label/model edits to the already-running agent immediately too —
          // otherwise picking a model here silently does nothing until Reset.
          const agent = state.agents[id];
          if (agent) {
            if (partial.label !== undefined) agent.label = partial.label.trim() || agent.label;
            if (partial.model !== undefined) agent.model = partial.model;
          }
        }),

      setAvailableModels: (models) =>
        set((state) => {
          state.availableModels = models;
        }),

      setConnectionStatus: (status, error = null) =>
        set((state) => {
          state.connectionStatus = status;
          state.connectionError = error;
        }),

      selectAgent: (id) =>
        set((state) => {
          state.selectedAgentId = id;
        }),

      play: () =>
        set((state) => {
          state.clock.running = true;
        }),

      pause: () =>
        set((state) => {
          state.clock.running = false;
        }),

      setSpeed: (ticksPerSecond) =>
        set((state) => {
          state.clock.ticksPerSecond = ticksPerSecond;
        }),

      pushLog: (text, kind) =>
        set((state) => {
          state.log.push({ id: makeLogId(), tick: state.clock.tick, text, kind });
          if (state.log.length > 500) state.log.splice(0, state.log.length - 500);
        }),

      reset: () =>
        set((state) => {
          const fresh = freshWorldAndAgents(state.agentConfigs);
          state.world = fresh.world;
          state.agents = fresh.agents;
          state.agentOrder = fresh.agentOrder;
          state.zones = createZones();
          state.activeConversations = {};
          state.modelStats = {};
          state.affinityHistory = [];
          state.proposals = [];
          state.log = freshLog();
          state.clock = { tick: 0, running: false, ticksPerSecond: 1 };
          state.selectedAgentId = null;
        }),

      mutate: (fn) => set((state) => fn(state)),
    };
  }),
);

export function serializeSnapshot(): {
  agents: Record<string, Agent>;
  agentOrder: string[];
  agentConfigs: AgentConfig[];
  zones: Zone[];
  modelStats: Record<string, ModelStats>;
  affinityHistory: AffinityPoint[];
  proposals: Proposal[];
  log: LogEntry[];
  clock: SimClock;
  settings: ConnectionSettings;
} {
  const s = useSimStore.getState();
  return {
    agents: s.agents,
    agentOrder: s.agentOrder,
    agentConfigs: s.agentConfigs,
    zones: s.zones,
    modelStats: s.modelStats,
    affinityHistory: s.affinityHistory,
    proposals: s.proposals,
    log: s.log,
    clock: { ...s.clock, running: false },
    settings: s.settings,
  };
}

export function loadSnapshot(snapshot: {
  agents: Record<string, Agent>;
  agentOrder: string[];
  agentConfigs: AgentConfig[];
  zones?: Zone[];
  modelStats?: Record<string, ModelStats>;
  affinityHistory?: AffinityPoint[];
  proposals?: Proposal[];
  log: LogEntry[];
  clock: SimClock;
  settings: ConnectionSettings;
}): void {
  // A loaded save brings its own agent ids in from outside this session's counter — bump it
  // past whatever's in the save so a freshly-added agent afterward can't collide.
  agentIdCounter.ensureAbove((snapshot.agentConfigs ?? []).map((c) => c.id));

  useSimStore.setState((state) => {
    state.agents = snapshot.agents;
    state.agentOrder = snapshot.agentOrder;
    state.agentConfigs = snapshot.agentConfigs ?? state.agentConfigs;
    // Older saves predate zones (or house ownership) — fall back to a fresh unowned set
    // rather than leaving zones undefined.
    state.zones = snapshot.zones ?? createZones();
    state.modelStats = snapshot.modelStats ?? {};
    state.affinityHistory = snapshot.affinityHistory ?? [];
    state.proposals = snapshot.proposals ?? [];
    state.log = snapshot.log;
    state.clock = { ...snapshot.clock, running: false };
    state.settings = snapshot.settings;
  });
}
