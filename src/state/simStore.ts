import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Agent, LogEntry, SimClock, World } from '../sim/types';
import { buildWorld } from '../sim/world';
import { createInitialAgents } from '../sim/agents';
import { DEFAULT_SETTINGS, type OllamaSettings } from '../llm/ollamaClient';

let logCounter = 0;
export function makeLogId(): string {
  logCounter += 1;
  return `log_${Date.now().toString(36)}_${logCounter}`;
}

export type ConnectionStatus = 'unknown' | 'checking' | 'ok' | 'error';

export interface SimState {
  world: World;
  agents: Record<string, Agent>;
  agentOrder: string[];
  log: LogEntry[];
  clock: SimClock;
  settings: OllamaSettings;
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  availableModels: string[];
  selectedAgentId: string | null;

  setSettings: (partial: Partial<OllamaSettings>) => void;
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

function freshWorldAndAgents(): { world: World; agents: Record<string, Agent>; agentOrder: string[] } {
  const world = buildWorld();
  const agentList = createInitialAgents(world);
  const agents: Record<string, Agent> = {};
  for (const a of agentList) agents[a.id] = a;
  return { world, agents, agentOrder: agentList.map((a) => a.id) };
}

export const useSimStore = create<SimState>()(
  immer((set) => {
    const { world, agents, agentOrder } = freshWorldAndAgents();

    return {
      world,
      agents,
      agentOrder,
      log: [
        {
          id: makeLogId(),
          tick: 0,
          text: 'The town wakes up.',
          kind: 'system',
        },
      ],
      clock: { tick: 0, running: false, ticksPerSecond: 1 },
      settings: DEFAULT_SETTINGS,
      connectionStatus: 'unknown',
      connectionError: null,
      availableModels: [],
      selectedAgentId: null,

      setSettings: (partial) =>
        set((state) => {
          Object.assign(state.settings, partial);
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
          if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
        }),

      reset: () =>
        set((state) => {
          const fresh = freshWorldAndAgents();
          state.world = fresh.world;
          state.agents = fresh.agents;
          state.agentOrder = fresh.agentOrder;
          state.log = [{ id: makeLogId(), tick: 0, text: 'The town wakes up.', kind: 'system' }];
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
  log: LogEntry[];
  clock: SimClock;
  settings: OllamaSettings;
} {
  const s = useSimStore.getState();
  return {
    agents: s.agents,
    agentOrder: s.agentOrder,
    log: s.log,
    clock: { ...s.clock, running: false },
    settings: s.settings,
  };
}

export function loadSnapshot(snapshot: {
  agents: Record<string, Agent>;
  agentOrder: string[];
  log: LogEntry[];
  clock: SimClock;
  settings: OllamaSettings;
}): void {
  useSimStore.setState((state) => {
    state.agents = snapshot.agents;
    state.agentOrder = snapshot.agentOrder;
    state.log = snapshot.log;
    state.clock = { ...snapshot.clock, running: false };
    state.settings = snapshot.settings;
  });
}
