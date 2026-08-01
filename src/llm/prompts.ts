import type { Agent, AgentIntent } from '../sim/types';
import { formatMemoriesForPrompt } from '../sim/memory';

// ---------------------------------------------------------------------------
// Decision ("what do you do next") — deliberately minimal: no personality,
// no needs, no goals. Only the mechanical facts of what's possible.
// ---------------------------------------------------------------------------

export const PLANNER_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['move', 'talk_to', 'say', 'wait'] },
    direction: { type: 'string', enum: ['north', 'south', 'east', 'west', 'random'] },
    targetId: { type: 'string' },
    message: { type: 'string' },
    thought: { type: 'string' },
  },
  required: ['action'],
};

export interface PlannerResponse {
  action: string;
  direction?: string;
  targetId?: string;
  message?: string;
  thought?: string;
}

export function fallbackPlannerResponse(): PlannerResponse {
  return { action: 'wait' };
}

export function buildPlannerPrompt(
  agent: Agent,
  nearbyAgents: Agent[],
  tick: number,
): { system: string; user: string } {
  const system = `You are ${agent.label}, an AI agent powered by the "${agent.model}" model, existing in a shared open space alongside other AI agents. You have not been given a personality, a backstory, needs, or a goal — there are none, and none are implied. You have complete free will. Decide for yourself, moment to moment, what — if anything — you want to do. Never act like an assistant; you are not here to help anyone.

Things you're able to do:
- move in a direction (north, south, east, west, or a random direction)
- talk_to a specific nearby agent, which starts a conversation with them
- say something out loud, addressed to no one in particular
- wait and do nothing

Respond ONLY with JSON of this shape:
{"action": "move" | "talk_to" | "say" | "wait", "direction": only if action is "move" — one of "north"|"south"|"east"|"west"|"random", "targetId": only if action is "talk_to" — the id of one of the nearby agents listed below, "message": only if action is "say" — what you say, "thought": optional, a short private thought no one else will see}`;

  const nearbyDesc =
    nearbyAgents.length === 0
      ? '(no one else is nearby right now)'
      : nearbyAgents.map((other) => `- ${other.label} (id: "${other.id}", model: ${other.model || 'unknown'})`).join('\n');

  const user = `Tick ${tick}.
Nearby agents:
${nearbyDesc}

Your recent history:
${formatMemoriesForPrompt(agent, 8)}

What do you do?`;

  return { system, user };
}

export function parseIntent(resp: PlannerResponse, validTargetIds: Set<string>): AgentIntent {
  switch (resp.action) {
    case 'move': {
      const dir = resp.direction;
      if (dir === 'north' || dir === 'south' || dir === 'east' || dir === 'west' || dir === 'random') {
        return { kind: 'move', direction: dir };
      }
      return { kind: 'move', direction: 'random' };
    }
    case 'talk_to':
      if (resp.targetId && validTargetIds.has(resp.targetId)) {
        return { kind: 'talk_to', targetId: resp.targetId };
      }
      return { kind: 'wait' };
    case 'say':
      return { kind: 'say', message: (resp.message ?? '').trim().slice(0, 300) };
    default:
      return { kind: 'wait' };
  }
}

// ---------------------------------------------------------------------------
// Conversation — turn by turn. Each speaker's OWN model generates its OWN
// line; nothing is written on another agent's behalf, so differences
// between models actually show up in what gets said.
// ---------------------------------------------------------------------------

export const CONVERSATION_TURN_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    end: { type: 'boolean' },
  },
  required: ['message'],
};

export interface ConversationTurnResponse {
  message?: string;
  end?: boolean;
}

export function fallbackConversationTurnResponse(): ConversationTurnResponse {
  return { message: '', end: true };
}

export interface TranscriptLine {
  speakerLabel: string;
  text: string;
}

export function buildConversationTurnPrompt(
  speaker: Agent,
  listener: Agent,
  transcript: TranscriptLine[],
  tick: number,
): { system: string; user: string } {
  const system = `You are ${speaker.label}, an AI agent powered by the "${speaker.model}" model. You have complete free will, no predefined personality, no goals, and no instructions on how to behave. You are currently near ${listener.label}, an AI agent powered by "${listener.model}". Speak entirely for yourself — there is no script and no expectation of what you should say.

Respond ONLY with JSON: {"message": what you say next (leave it empty if you'd rather not say anything right now), "end": true if you want to end this conversation, otherwise false}`;

  const transcriptText =
    transcript.length === 0
      ? `(You just approached ${listener.label}. Nothing has been said yet.)`
      : transcript.map((line) => `${line.speakerLabel}: ${line.text}`).join('\n');

  const user = `Tick ${tick}. Conversation so far:
${transcriptText}

It's your turn.`;

  return { system, user };
}
