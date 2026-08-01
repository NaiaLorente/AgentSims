import type { Agent, AgentIntent, Zone } from '../sim/types';
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
    action: {
      type: 'string',
      enum: ['move', 'go_to', 'talk_to', 'say', 'satisfy_need', 'buy_food', 'take_job', 'work', 'wait'],
    },
    direction: { type: 'string', enum: ['north', 'south', 'east', 'west', 'random'] },
    targetId: { type: 'string' },
    message: { type: 'string' },
    need: { type: 'string', enum: ['energy', 'fun'] },
    title: { type: 'string' },
    thought: { type: 'string' },
  },
  required: ['action'],
};

export interface PlannerResponse {
  action: string;
  direction?: string;
  targetId?: string;
  message?: string;
  need?: string;
  title?: string;
  thought?: string;
}

export function fallbackPlannerResponse(): PlannerResponse {
  return { action: 'wait' };
}

const ZONE_DESCRIPTIONS: Record<Zone['kind'], string> = {
  house: 'a place to rest and restore energy',
  restaurant: 'a place to buy food, or to work if you have a job here',
  shop: 'a place to work if you have a job here',
  park: 'a place to have fun',
};

function describeZone(zone: Zone): string {
  return `- ${zone.name} (id: "${zone.id}") — ${ZONE_DESCRIPTIONS[zone.kind]}`;
}

function needStatus(value: number): string {
  if (value >= 70) return 'fine';
  if (value >= 40) return 'could be better';
  return 'low';
}

function describeSelf(agent: Agent): string {
  const n = agent.needs;
  const needsLine = `hunger: ${Math.round(n.hunger)}/100 (${needStatus(n.hunger)}), energy: ${Math.round(n.energy)}/100 (${needStatus(n.energy)}), social: ${Math.round(n.social)}/100 (${needStatus(n.social)}), fun: ${Math.round(n.fun)}/100 (${needStatus(n.fun)})`;
  const roles = agent.roles.length === 0 ? 'none' : agent.roles.map((r) => `"${r.title}" at ${r.zoneId}`).join(', ');
  return `Right now: ${needsLine}. Money: $${agent.wallet}. Roles you've claimed: ${roles}.`;
}

function describeRelationships(agent: Agent): string {
  const rels = Object.values(agent.relationships);
  if (rels.length === 0) return '';
  const lines = rels.map((r) => `- ${r.otherLabel}: ${r.label} (affinity ${r.affinity})`).join('\n');
  return `\n\nHow you see people you've met:\n${lines}`;
}

export function buildPlannerPrompt(agent: Agent, nearbyAgents: Agent[], zones: Zone[]): { system: string; user: string } {
  const system = `You are ${agent.label}.

You can:
- move (north, south, east, west, or let it be random)
- go to a specific place on the map, by its id (see the list below)
- talk to someone nearby, if you want to
- say something out loud, to no one in particular
- rest to restore energy, or have fun, if you're standing at a place suited for it — pick which need
- buy food, if you're standing at a place that sells it — costs money, restores hunger
- take a job or role somewhere, in your own words (a title you make up) — only takes effect if you're standing at the place right now
- work, if you're standing at the place where you hold a job — earns money
- do nothing

Respond ONLY with JSON of this shape:
{"action": "move" | "go_to" | "talk_to" | "say" | "satisfy_need" | "buy_food" | "take_job" | "work" | "wait", "direction": only if action is "move" — one of "north"|"south"|"east"|"west"|"random", "targetId": only if action is "go_to" (id of a place from the list) or "talk_to" (id of someone listed below), "message": only if action is "say", "need": only if action is "satisfy_need" — "energy" or "fun", "title": only if action is "take_job" — whatever role or job you're claiming, in your own words, "thought": optional, something private no one else sees}`;

  const nearbyDesc =
    nearbyAgents.length === 0
      ? '(no one nearby right now)'
      : nearbyAgents.map((other) => `- ${other.label} (id: "${other.id}")`).join('\n');

  const zonesBlock = `\n\nPlaces on the map:\n${zones.map(describeZone).join('\n')}`;

  const user = `${describeSelf(agent)}${describeRelationships(agent)}

People nearby:
${nearbyDesc}${zonesBlock}

What's happened so far:
${formatMemoriesForPrompt(agent, 14)}

What do you do?`;

  return { system, user };
}

export function parseIntent(resp: PlannerResponse, validTargetIds: Set<string>, validZoneIds: Set<string>): AgentIntent {
  switch (resp.action) {
    case 'move': {
      const dir = resp.direction;
      if (dir === 'north' || dir === 'south' || dir === 'east' || dir === 'west' || dir === 'random') {
        return { kind: 'move', direction: dir };
      }
      return { kind: 'move', direction: 'random' };
    }
    case 'go_to':
      if (resp.targetId && validZoneIds.has(resp.targetId)) {
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
    case 'satisfy_need':
      if (resp.need === 'energy' || resp.need === 'fun') {
        return { kind: 'satisfy_need', need: resp.need };
      }
      return { kind: 'wait' };
    case 'buy_food':
      return { kind: 'buy_food' };
    case 'take_job': {
      const title = (resp.title ?? '').trim().slice(0, 80);
      if (!title) return { kind: 'wait' };
      return { kind: 'take_job', title };
    }
    case 'work':
      return { kind: 'work' };
    default:
      return { kind: 'wait' };
  }
}

// ---------------------------------------------------------------------------
// Conversation — turn by turn. Each speaker's OWN model generates its OWN
// line; nothing is written on another agent's behalf. Each turn also gets
// the speaker's own memory of this specific other agent, so they don't
// re-introduce themselves every single time they meet. A turn can also
// optionally update how the speaker feels about the listener — still purely
// the speaker's own call, not something the engine infers from the words.
// ---------------------------------------------------------------------------

export const CONVERSATION_TURN_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    end: { type: 'boolean' },
    relationshipLabel: { type: 'string' },
    affinityDelta: { type: 'number' },
  },
  required: ['message'],
};

export interface ConversationTurnResponse {
  message?: string;
  end?: boolean;
  relationshipLabel?: string;
  affinityDelta?: number;
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

Respond ONLY with JSON: {"message": what you say next (leave it empty if you'd rather not say anything right now), "end": true if you want to end this, otherwise false, "relationshipLabel": optional — a short phrase in your own words for how you'd describe ${listener.label} to yourself right now (e.g. "a new friend", "annoying", "someone I trust"), only include this if it's changed, "affinityDelta": optional — a small number from -10 to 10 for how this exchange changed how you feel about ${listener.label} (positive if better, negative if worse), only include this if something changed}`;

  const existing = speaker.relationships[listener.id];
  const relationshipBlock = existing
    ? `Right now you think of ${listener.label} as: "${existing.label}" (affinity ${existing.affinity}).\n\n`
    : '';

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

  const user = `${relationshipBlock}${historyBlock}Right now:
${transcriptText}

Your turn.`;

  return { system, user };
}
