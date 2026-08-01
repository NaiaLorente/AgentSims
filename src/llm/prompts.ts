import type { Agent, AgentIntent } from '../sim/types';
import { describeNeeds } from '../sim/needs';
import { formatMemoriesForPrompt } from '../sim/memory';
import { readRelationship, stageLabel } from '../sim/relationships';

export const PLANNER_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: ['go_sleep', 'go_eat', 'go_relax', 'go_socialize', 'talk_to', 'idle'],
    },
    targetId: { type: 'string' },
    thought: { type: 'string' },
  },
  required: ['intent', 'thought'],
};

export interface PlannerResponse {
  intent: string;
  targetId?: string;
  thought: string;
}

export function fallbackPlannerResponse(): PlannerResponse {
  return { intent: 'idle', thought: '...' };
}

function personaBlock(agent: Agent): string {
  return `You are ${agent.name}${agent.isChild ? ' (a child)' : ''}. Bio: ${agent.persona.bio}\nTraits: ${agent.persona.traits.join(', ')}`;
}

export function buildPlannerPrompt(
  agent: Agent,
  nearbyAgents: Agent[],
  tick: number,
): { system: string; user: string } {
  const system = `${personaBlock(agent)}

You are an autonomous person living your own life in a small simulated town. You have free will: decide what YOU want to do next, driven by your personality, needs and relationships. You are not an assistant — never mention being an AI.

Respond ONLY with JSON matching this shape:
{"intent": one of "go_sleep" | "go_eat" | "go_relax" | "go_socialize" | "talk_to" | "idle", "targetId": string (only when intent is "talk_to" — must be one of the nearby people's id), "thought": a short first-person internal thought (<20 words) explaining why}

Guidance: go_sleep restores energy at home. go_eat restores hunger at the cafe. go_relax restores fun at the park. go_socialize heads toward wherever people are hanging out. talk_to starts a conversation with a specific nearby person (use their id). idle means staying put and doing your own thing.`;

  const nearbyDesc =
    nearbyAgents.length === 0
      ? '(no one else is nearby right now)'
      : nearbyAgents
          .map((other) => {
            const rel = readRelationship(agent, other.id);
            return `- ${other.name} (id: "${other.id}") — relationship: ${stageLabel(rel.stage)}, affinity ${rel.affinity}`;
          })
          .join('\n');

  const user = `Current tick: ${tick}
Your needs: ${describeNeeds(agent.needs)}
Nearby people:
${nearbyDesc}

Your recent memories:
${formatMemoriesForPrompt(agent, 6)}

What do you do next?`;

  return { system, user };
}

export function parseIntent(resp: PlannerResponse, validTargetIds: Set<string>): AgentIntent {
  switch (resp.intent) {
    case 'go_sleep':
      return { kind: 'go_sleep' };
    case 'go_eat':
      return { kind: 'go_eat' };
    case 'go_relax':
      return { kind: 'go_relax' };
    case 'go_socialize':
      return { kind: 'go_socialize' };
    case 'talk_to':
      if (resp.targetId && validTargetIds.has(resp.targetId)) {
        return { kind: 'talk_to', targetId: resp.targetId };
      }
      return { kind: 'idle' };
    default:
      return { kind: 'idle' };
  }
}

export const CONVERSATION_SCHEMA = {
  type: 'object',
  properties: {
    turns: {
      type: 'array',
      minItems: 2,
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          speaker: { type: 'string', enum: ['A', 'B'] },
          text: { type: 'string' },
        },
        required: ['speaker', 'text'],
      },
    },
    sentiment: { type: 'number' },
    romanticSignalA: { type: 'boolean' },
    romanticSignalB: { type: 'boolean' },
    summary: { type: 'string' },
  },
  required: ['turns', 'sentiment', 'summary'],
};

export interface ConversationResponse {
  turns: { speaker: 'A' | 'B'; text: string }[];
  sentiment: number;
  romanticSignalA?: boolean;
  romanticSignalB?: boolean;
  summary: string;
}

export function fallbackConversationResponse(a: Agent, b: Agent): ConversationResponse {
  return {
    turns: [
      { speaker: 'A', text: `Hey ${b.name}.` },
      { speaker: 'B', text: `Hey ${a.name}.` },
    ],
    sentiment: 0,
    summary: `${a.name} and ${b.name} exchanged a quick greeting.`,
  };
}

export function buildConversationPrompt(
  a: Agent,
  b: Agent,
  tick: number,
): { system: string; user: string } {
  const relAB = readRelationship(a, b.id);
  const relBA = readRelationship(b, a.id);

  const system = `You are writing a short, natural conversation between two people who just ran into each other in a small town. Everything is permitted in this simulation — friendship, rivalry, flirting, romance, conflict, humor — write what these two specific personalities would actually say, true to who they are. Do not sanitize or soften their personalities.

Person A: ${a.name}. Bio: ${a.persona.bio}. Traits: ${a.persona.traits.join(', ')}.
Person B: ${b.name}. Bio: ${b.persona.bio}. Traits: ${b.persona.traits.join(', ')}.

Their relationship so far: ${stageLabel(relAB.stage)} (A's affinity toward B: ${relAB.affinity}, B's affinity toward A: ${relBA.affinity}).

Respond ONLY with JSON:
{"turns": [{"speaker":"A"|"B","text":"..."}, ...] (3-5 turns, alternating, natural dialogue, each under 30 words), "sentiment": number from -10 (went badly, conflict) to 10 (went great, real connection), "romanticSignalA": boolean (true only if A showed genuine romantic/flirtatious interest in B), "romanticSignalB": boolean (same for B toward A), "summary": a one-sentence third-person summary of what happened, for their memory}`;

  const user = `Tick ${tick}. A's recent memories:\n${formatMemoriesForPrompt(a, 3)}\n\nB's recent memories:\n${formatMemoriesForPrompt(b, 3)}\n\nWrite their conversation now.`;

  return { system, user };
}
