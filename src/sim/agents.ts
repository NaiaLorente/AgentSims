import type { Agent, World } from './types';
import { randomTile } from './world';
import { agentIdCounter } from './ids';

export interface AgentConfig {
  id: string;
  label: string;
  model: string;
}

const COLOR_PALETTE = [
  '#f97316',
  '#22c55e',
  '#06b6d4',
  '#a855f7',
  '#ef4444',
  '#eab308',
  '#3b82f6',
  '#ec4899',
];

export function makeAgentConfigId(): string {
  return agentIdCounter.next();
}

/**
 * "Agent" reads as spy/secret-agent fiction to a language model — a
 * surprisingly strong prior in training data — which can bias conversations
 * toward "mission" tropes independent of anything actually said. Default
 * labels are deliberately just letters instead. Fully renameable either way.
 */
export function defaultLabelForIndex(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}

export function defaultAgentConfigs(): AgentConfig[] {
  return [0, 1, 2].map((i) => ({ id: makeAgentConfigId(), label: defaultLabelForIndex(i), model: '' }));
}

/** Stable per-id color so an agent doesn't change color when others are added/removed. */
export function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
}

const STARTING_NEED = 70;
const STARTING_WALLET = 20;

/** Builds one live, running agent from a config. No persona, no fixed goals — needs, wallet,
 *  roles and relationships are all just state the agent can act on (or ignore) as it chooses. */
export function createAgentFromConfig(config: AgentConfig, world: World, index: number): Agent {
  return {
    id: config.id,
    label: config.label.trim() || defaultLabelForIndex(index),
    model: config.model,
    color: colorForId(config.id),
    pos: randomTile(world),
    path: [],
    activity: { kind: 'idle', cooldownUntilTick: 0 },
    memory: [],
    reflections: [],
    lastReflectionTick: 0,
    speech: null,
    needs: { hunger: STARTING_NEED, energy: STARTING_NEED, social: STARTING_NEED, fun: STARTING_NEED },
    wallet: STARTING_WALLET,
    roles: [],
    relationships: {},
  };
}

/** Builds the live, running agents for a simulation from the configured roster. */
export function createAgentsFromConfigs(configs: AgentConfig[], world: World): Agent[] {
  return configs.map((config, index) => createAgentFromConfig(config, world, index));
}
