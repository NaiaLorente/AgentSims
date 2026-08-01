import type { Agent, World } from './types';
import { randomTile } from './world';

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

let configCounter = 0;

export function makeAgentConfigId(): string {
  configCounter += 1;
  return `agentcfg_${Date.now().toString(36)}_${configCounter}`;
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

/** Builds one live, running agent from a config. No persona, no needs. */
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
    speech: null,
  };
}

/** Builds the live, running agents for a simulation from the configured roster. */
export function createAgentsFromConfigs(configs: AgentConfig[], world: World): Agent[] {
  return configs.map((config, index) => createAgentFromConfig(config, world, index));
}
