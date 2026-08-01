import type { Agent, AgentIntent, WorldObject } from '../sim/types';
import { formatMemoriesForPrompt } from '../sim/memory';

// ---------------------------------------------------------------------------
// These prompts deliberately avoid any mention of AI, models, language
// models, or "free will" as a concept — telling an agent what it *is* (an
// AI, a model, something without personality) primes it to talk about that
// instead of just existing and acting. Instead we describe only what's
// mechanically possible, first person, the way a text adventure would.
// ---------------------------------------------------------------------------

export const PLANNER_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['move', 'go_to', 'talk_to', 'say', 'create', 'wait'] },
    direction: { type: 'string', enum: ['north', 'south', 'east', 'west', 'random'] },
    targetId: { type: 'string' },
    message: { type: 'string' },
    content: { type: 'string' },
    thought: { type: 'string' },
  },
  required: ['action'],
};

export interface PlannerResponse {
  action: string;
  direction?: string;
  targetId?: string;
  message?: string;
  content?: string;
  thought?: string;
}

export function fallbackPlannerResponse(): PlannerResponse {
  return { action: 'wait' };
}

function describeObject(o: WorldObject): string {
  const origin = o.natural ? o.content : `${o.creatorLabel} left this: "${o.content}"`;
  const additions = o.additions.map((a) => `${a.agentLabel} added: "${a.content}"`);
  const parts = [origin, ...additions];
  return `- ${parts.join(' — ')} (id: "${o.id}")`;
}

export function buildPlannerPrompt(
  agent: Agent,
  nearbyAgents: Agent[],
  nearbyObjects: WorldObject[],
): { system: string; user: string } {
  const system = `You are ${agent.label}.

You can:
- move (north, south, east, west, or let it be random)
- go to a specific place you remember, if you know its id (see your history below) — it doesn't have to be nearby right now
- talk to someone nearby, if you want to
- say something out loud, to no one in particular
- make something — leave anything at all where you're standing: an object, a message, a structure, a piece of writing, anything, described however you want. If something is already there (see below), you can add to it instead of starting something new
- do nothing

Respond ONLY with JSON of this shape:
{"action": "move" | "go_to" | "talk_to" | "say" | "create" | "wait", "direction": only if action is "move" — one of "north"|"south"|"east"|"west"|"random", "targetId": only if action is "go_to" (the id of a place from your history) or "talk_to" (id of someone listed below) or "create" and you're adding onto something that's already there (its id, from the list below), "message": only if action is "say", "content": only if action is "create" — whatever you're making or adding, "thought": optional, something private no one else sees}`;

  const nearbyDesc =
    nearbyAgents.length === 0
      ? '(no one nearby right now)'
      : nearbyAgents.map((other) => `- ${other.label} (id: "${other.id}")`).join('\n');

  const objectsBlock =
    nearbyObjects.length === 0 ? '' : `\n\nNearby:\n${nearbyObjects.map(describeObject).join('\n')}`;

  const user = `People nearby:
${nearbyDesc}${objectsBlock}

What's happened so far:
${formatMemoriesForPrompt(agent, 14)}

What do you do?`;

  return { system, user };
}

export function parseIntent(
  resp: PlannerResponse,
  validTargetIds: Set<string>,
  validObjectIds: Set<string>,
): AgentIntent {
  switch (resp.action) {
    case 'move': {
      const dir = resp.direction;
      if (dir === 'north' || dir === 'south' || dir === 'east' || dir === 'west' || dir === 'random') {
        return { kind: 'move', direction: dir };
      }
      return { kind: 'move', direction: 'random' };
    }
    case 'go_to':
      if (resp.targetId) {
        return { kind: 'go_to', targetId: resp.targetId };
      }
      return { kind: 'wait' };
    case 'talk_to':
      if (resp.targetId && validTargetIds.has(resp.targetId)) {
        return { kind: 'talk_to', targetId: resp.targetId };
      }
      return { kind: 'wait' };
    case 'say':
      return { kind: 'say', message: (resp.message ?? '').trim().slice(0, 300) };
    case 'create': {
      const targetId = resp.targetId && validObjectIds.has(resp.targetId) ? resp.targetId : undefined;
      return { kind: 'create', content: (resp.content ?? '').trim().slice(0, 300), targetId };
    }
    default:
      return { kind: 'wait' };
  }
}

// ---------------------------------------------------------------------------
// Conversation — turn by turn. Each speaker's OWN model generates its OWN
// line; nothing is written on another agent's behalf. Each turn also gets
// the speaker's own memory of this specific other agent, so they don't
// re-introduce themselves every single time they meet.
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
): { system: string; user: string } {
  const system = `You are ${speaker.label}. You're currently with ${listener.label}.

Respond ONLY with JSON: {"message": what you say next (leave it empty if you'd rather not say anything right now), "end": true if you want to end this, otherwise false}`;

  const priorHistory = speaker.memory
    .filter((m) => m.text.includes(listener.label))
    .slice(-8)
    .map((m) => `- ${m.text}`)
    .join('\n');

  const historyBlock = priorHistory ? `What you remember about ${listener.label}:\n${priorHistory}\n\n` : '';

  const transcriptText =
    transcript.length === 0
      ? '(Nothing said yet this time.)'
      : transcript.map((line) => `${line.speakerLabel}: ${line.text}`).join('\n');

  const user = `${historyBlock}Right now:
${transcriptText}

Your turn.`;

  return { system, user };
}
