import type { Agent, MemoryEvent, MemoryKind } from './types';

const MAX_MEMORIES = 60;
let counter = 0;

export function makeMemoryId(): string {
  counter += 1;
  return `mem_${Date.now().toString(36)}_${counter}`;
}

export function addMemory(agent: Agent, tick: number, kind: MemoryKind, text: string): void {
  const event: MemoryEvent = { id: makeMemoryId(), tick, kind, text };
  agent.memory.push(event);
  if (agent.memory.length > MAX_MEMORIES) {
    agent.memory.splice(0, agent.memory.length - MAX_MEMORIES);
  }
}

/** Most recent memories first, for prompt context (kept short to save tokens). */
export function recentMemories(agent: Agent, count = 6): MemoryEvent[] {
  return agent.memory.slice(-count).reverse();
}

export function formatMemoriesForPrompt(agent: Agent, count = 6): string {
  const mems = recentMemories(agent, count);
  if (mems.length === 0) return '(no memories yet)';
  return mems.map((m) => `- [${m.kind}] ${m.text}`).join('\n');
}
