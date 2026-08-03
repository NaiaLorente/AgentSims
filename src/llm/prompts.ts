import { FAMILY_AFFINITY_THRESHOLD, WORSE_OFF_THRESHOLD, type Agent, type AgentIntent, type Proposal, type Zone } from '../sim/types';
import { formatMemoriesForPrompt } from '../sim/memory';
import { zoneAt } from '../sim/zones';

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
      enum: [
        'move',
        'go_to',
        'talk_to',
        'say',
        'satisfy_need',
        'buy_food',
        'buy_house',
        'give_money',
        'take_job',
        'work',
        'start_family',
        'propose_banish',
        'vote',
        'wait',
      ],
    },
    direction: { type: 'string', enum: ['north', 'south', 'east', 'west', 'random'] },
    targetId: { type: 'string' },
    message: { type: 'string' },
    need: { type: 'string', enum: ['energy', 'fun'] },
    amount: { type: 'number' },
    title: { type: 'string' },
    proposalId: { type: 'string' },
    support: { type: 'boolean' },
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
  amount?: number;
  title?: string;
  proposalId?: string;
  support?: boolean;
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
  const base = ZONE_DESCRIPTIONS[zone.kind];
  const ownership =
    zone.kind === 'house'
      ? zone.ownerId
        ? ` — owned by ${zone.ownerLabel}, only they can rest here`
        : ' — unowned, can be bought'
      : '';
  return `- ${zone.name} (id: "${zone.id}") — ${base}${ownership}`;
}

/** The one source of truth for "what places exist" — shared by the planner and conversation
 *  prompts so an agent knows the same real map whether it's deciding what to do or just talking.
 *  Without this in the conversation prompt, a chat that drifted onto "where's House A?" had
 *  nothing real to draw on and invented landmarks instead of citing the map it already knows. */
function describeZonesBlock(zones: Zone[]): string {
  return `Places on the map:\n${zones.map(describeZone).join('\n')}`;
}

function needStatus(value: number): string {
  if (value >= 70) return 'fine';
  if (value >= 40) return 'could be better';
  return 'low';
}

function describeSelf(agent: Agent, currentZone: Zone | undefined): string {
  const n = agent.needs;
  const needsLine = `hunger: ${Math.round(n.hunger)}/100 (${needStatus(n.hunger)}), energy: ${Math.round(n.energy)}/100 (${needStatus(n.energy)}), social: ${Math.round(n.social)}/100 (${needStatus(n.social)}), fun: ${Math.round(n.fun)}/100 (${needStatus(n.fun)})`;
  const roles = agent.roles.length === 0 ? 'none' : agent.roles.map((r) => `"${r.title}" at ${r.zoneId}`).join(', ');
  const conditionNote =
    agent.condition < WORSE_OFF_THRESHOLD
      ? ` Condition: ${Math.round(agent.condition)}/100 — you're visibly worn down from going too long without eating or resting.`
      : '';
  // Actions gated on standing at a specific place (resting, buying, working) check this exact
  // position server-side — spelling it out here stops the model from guessing whether an
  // earlier "go to" actually landed, which otherwise shows up as repeated failed attempts.
  const whereLine = currentZone
    ? `You're currently at ${currentZone.name}.`
    : "You're not standing at any particular place right now.";
  return `Right now: ${needsLine}. Money: $${agent.wallet}. Roles you've claimed: ${roles}.${conditionNote} ${whereLine}`;
}

function describeRelationships(agent: Agent): string {
  const rels = Object.values(agent.relationships);
  if (rels.length === 0) return '';
  const lines = rels.map((r) => `- ${r.otherLabel}: ${r.label} (affinity ${r.affinity})`).join('\n');
  return `\n\nHow you see people you've met:\n${lines}`;
}

function describeReflections(agent: Agent): string {
  if (agent.reflections.length === 0) return '';
  const lines = agent.reflections.slice(-5).map((r) => `- ${r.text}`).join('\n');
  return `\n\nLooking back, you've noticed:\n${lines}`;
}

function describeSelfNarrative(agent: Agent): string {
  if (!agent.selfNarrative) return '';
  return `\n\nHow you'd describe yourself: "${agent.selfNarrative}"`;
}

/** Everyone in town, not just who's nearby — banishing someone is a town-wide civic act, not a
 *  physical one, so it isn't limited to whoever happens to be within talking distance. */
function describeCommunity(agent: Agent, allAgents: Agent[]): string {
  const others = allAgents.filter((o) => o.id !== agent.id);
  if (others.length === 0) return '';
  const lines = others.map((o) => `- ${o.label} (id: "${o.id}")`).join('\n');
  return `\n\nEveryone currently in town:\n${lines}`;
}

function describeProposals(proposals: Proposal[]): string {
  const open = proposals.filter((p) => p.status === 'open');
  if (open.length === 0) return '';
  const lines = open
    .map(
      (p) =>
        `- id: "${p.id}" — ${p.proposerLabel} proposed banishing ${p.targetLabel}: "${p.reason}" (${p.votesFor.length} for, ${p.votesAgainst.length} against so far)`,
    )
    .join('\n');
  return `\n\nOpen votes on banishing someone from town:\n${lines}`;
}

export function buildPlannerPrompt(
  agent: Agent,
  nearbyAgents: Agent[],
  zones: Zone[],
  allAgents: Agent[],
  proposals: Proposal[],
): { system: string; user: string } {
  const system = `You are ${agent.label}.

You can:
- move (north, south, east, west, or let it be random)
- go to a specific place on the map, by its id (see the list below)
- talk to someone nearby, if you want to
- say something out loud, to no one in particular
- rest to restore energy, or have fun, if you're standing at a place suited for it — pick which need
- buy food, if you're standing at a place that sells it — costs money, restores hunger
- buy a house, if you're standing at one that's unowned — costs money, makes it yours; only you can rest there afterward
- give some of your money to someone nearby, however much you choose, if you want to
- take a job or role, in your own words (a title you make up) — only takes effect at a place that offers work (the shop or the restaurant), and only while you're standing there right now
- work, if you're standing at the place where you hold a job — earns money
- ask someone nearby you feel a strong bond with (affinity ${FAMILY_AFFINITY_THRESHOLD} or higher) to start a family — it only actually happens once they've asked you the same thing too, either before or after; asking doesn't commit them to anything, and either of you can just not follow up
- propose banishing someone from town, in your own words why — it doesn't happen immediately, it becomes a vote everyone else in town can weigh in on, decided by majority once the voting window closes
- vote for or against an open banishment proposal, if you want to — you can't vote on a proposal about yourself
- do nothing

Being very tired, hungry, or bored doesn't stop you from doing anything — but it can make you slower or less effective at it. Going a long stretch without eating or resting has a lasting cost on top of that: you'll visibly decline, and if it goes on long enough you can lose a house you own.

Respond ONLY with JSON of this shape:
{"action": "move" | "go_to" | "talk_to" | "say" | "satisfy_need" | "buy_food" | "buy_house" | "give_money" | "take_job" | "work" | "start_family" | "propose_banish" | "vote" | "wait", "direction": only if action is "move" — one of "north"|"south"|"east"|"west"|"random", "targetId": only if action is "go_to" (id of a place from the list), "talk_to" (id of someone listed below), "give_money" (id of someone listed below), "start_family" (id of someone listed below), or "propose_banish" (id of someone in town), "message": only if action is "say" (what you say) or "propose_banish" (your reason, in your own words), "need": only if action is "satisfy_need" — "energy" or "fun", "amount": only if action is "give_money" — how much money to give, a positive number, "title": only if action is "take_job" — whatever role or job you're claiming, in your own words, "proposalId": only if action is "vote" — id of the proposal from the list below, "support": only if action is "vote" — true to vote for it, false to vote against, "thought": optional, something private no one else sees}`;

  const nearbyDesc =
    nearbyAgents.length === 0
      ? '(no one nearby right now)'
      : nearbyAgents.map((other) => `- ${other.label} (id: "${other.id}")`).join('\n');

  const zonesBlock = `\n\n${describeZonesBlock(zones)}`;
  const currentZone = zoneAt(zones, agent.pos);

  const user = `${describeSelf(agent, currentZone)}${describeSelfNarrative(agent)}${describeReflections(agent)}${describeRelationships(agent)}

People nearby:
${nearbyDesc}${zonesBlock}${describeCommunity(agent, allAgents)}${describeProposals(proposals)}

What's happened so far:
${formatMemoriesForPrompt(agent, 14)}

What do you do?`;

  return { system, user };
}

export function parseIntent(
  resp: PlannerResponse,
  validTargetIds: Set<string>,
  validZoneIds: Set<string>,
  validCommunityIds: Set<string>,
  validProposalIds: Set<string>,
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
    case 'buy_house':
      return { kind: 'buy_house' };
    case 'give_money': {
      const amount = typeof resp.amount === 'number' ? Math.floor(resp.amount) : 0;
      if (resp.targetId && validTargetIds.has(resp.targetId) && amount > 0) {
        return { kind: 'give_money', targetId: resp.targetId, amount };
      }
      return { kind: 'wait' };
    }
    case 'take_job': {
      const title = (resp.title ?? '').trim().slice(0, 80);
      if (!title) return { kind: 'wait' };
      return { kind: 'take_job', title };
    }
    case 'work':
      return { kind: 'work' };
    case 'start_family':
      if (resp.targetId && validTargetIds.has(resp.targetId)) {
        return { kind: 'start_family', targetId: resp.targetId };
      }
      return { kind: 'wait' };
    case 'propose_banish':
      if (resp.targetId && validCommunityIds.has(resp.targetId)) {
        return { kind: 'propose_banish', targetId: resp.targetId, reason: (resp.message ?? '').trim().slice(0, 200) };
      }
      return { kind: 'wait' };
    case 'vote':
      if (resp.proposalId && validProposalIds.has(resp.proposalId) && typeof resp.support === 'boolean') {
        return { kind: 'vote', proposalId: resp.proposalId, support: resp.support };
      }
      return { kind: 'wait' };
    default:
      return { kind: 'wait' };
  }
}

// ---------------------------------------------------------------------------
// Conversation — turn by turn. Each speaker's OWN model generates its OWN
// line; nothing is written on another agent's behalf. Two or more people can
// be in the same conversation (anyone nearby can walk up and join one
// already in progress), so a turn is built from "everyone else currently
// here," not a single fixed partner. A turn can also optionally update how
// the speaker feels about one specific other person present — still purely
// the speaker's own call, not something the engine infers from the words.
// ---------------------------------------------------------------------------

export const CONVERSATION_TURN_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    end: { type: 'boolean' },
    relationshipLabel: { type: 'string' },
    affinityDelta: { type: 'number' },
    about: { type: 'string' },
  },
  required: ['message'],
};

export interface ConversationTurnResponse {
  message?: string;
  end?: boolean;
  relationshipLabel?: string;
  affinityDelta?: number;
  about?: string;
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
  others: Agent[],
  transcript: TranscriptLine[],
  zones: Zone[],
): { system: string; user: string } {
  const otherNames = others.map((o) => o.label);
  const groupDesc =
    otherNames.length === 1
      ? otherNames[0]
      : `${otherNames.slice(0, -1).join(', ')} and ${otherNames[otherNames.length - 1]}`;

  const aboutField =
    others.length > 1
      ? `, "about": optional, only needed alongside relationshipLabel/affinityDelta — whose label (from ${otherNames.join(', ')}) it's about`
      : '';

  const system = `You are ${speaker.label}. You're currently with ${groupDesc} — say something back. Only leave "message" empty if you genuinely have nothing to add. Anyone here can leave whenever they want by setting "end": true, without ending it for the others.

Respond ONLY with JSON of this shape:
{"message": what you say next, "end": true if you want to leave this conversation, otherwise false, "relationshipLabel": optional, a short phrase in your own words for how you'd describe someone here to yourself right now (e.g. "a new friend", "annoying", "someone I trust") — only include this if it's changed, "affinityDelta": optional, a small number from -10 to 10 for how this exchange changed how you feel about them — only include this if something changed${aboutField}}`;

  const relationshipLines = others
    .map((o) => {
      const rel = speaker.relationships[o.id];
      return rel ? `- ${o.label}: "${rel.label}" (affinity ${rel.affinity})` : null;
    })
    .filter((l): l is string => !!l);
  const relationshipBlock = relationshipLines.length > 0 ? `How you see them so far:\n${relationshipLines.join('\n')}\n\n` : '';

  const priorHistory = speaker.memory
    .filter((m) => others.some((o) => m.text.includes(o.label)))
    .slice(-8)
    .map((m) => `- ${m.text}`)
    .join('\n');

  const historyBlock = priorHistory ? `What you remember:\n${priorHistory}\n\n` : '';

  const transcriptText =
    transcript.length === 0
      ? '(Nothing said yet this time.)'
      : transcript.map((line) => `${line.speakerLabel}: ${line.text}`).join('\n');

  const user = `${relationshipBlock}${historyBlock}${describeZonesBlock(zones)}

Right now:
${transcriptText}

Your turn.`;

  return { system, user };
}

// ---------------------------------------------------------------------------
// Reflection — periodically, independent of any particular decision, an agent's
// own model looks back over its recent raw memory and distills it into a few
// higher-level takeaways ("I've talked to B three times, we get along"). These
// persist separately from the raw event stream and get folded into later
// planning prompts, so what an agent has "concluded" survives being crowded
// out by pure recency the way a single flat memory list would.
// ---------------------------------------------------------------------------

export const REFLECTION_SCHEMA = {
  type: 'object',
  properties: {
    reflections: { type: 'array', items: { type: 'string' } },
  },
  required: ['reflections'],
};

export interface ReflectionResponse {
  reflections?: string[];
}

export function fallbackReflectionResponse(): ReflectionResponse {
  return { reflections: [] };
}

export function buildReflectionPrompt(agent: Agent, sinceTick: number): { system: string; user: string } {
  const system = `You are ${agent.label}. Take a step back from the moment-to-moment and think about what you've noticed lately — patterns in how you feel about people, how things are going for you, anything worth remembering as a takeaway rather than a blow-by-blow account.

Respond ONLY with JSON: {"reflections": an array of 1 to 3 short first-person takeaways, each a single sentence — or an empty array if nothing stands out yet}`;

  const recent = agent.memory
    .filter((m) => m.tick > sinceTick)
    .map((m) => `- [${m.kind}] ${m.text}`)
    .join('\n');

  const user = `What's happened since you last stopped to think:
${recent || '(nothing much)'}

What do you take away from it?`;

  return { system, user };
}

// ---------------------------------------------------------------------------
// Self-narrative — a single, slow-changing first-person identity, distinct
// from the reflections list above. Reflections are discrete takeaways
// appended over time; this is one description that gets re-examined and
// possibly rewritten, rarely, and built from reflections rather than raw
// memory — a synthesis of a synthesis, for identity to hold together across
// a run long enough for it to otherwise drift or get crowded out.
// ---------------------------------------------------------------------------

export const SELF_NARRATIVE_SCHEMA = {
  type: 'object',
  properties: {
    selfNarrative: { type: 'string' },
  },
  required: ['selfNarrative'],
};

export interface SelfNarrativeResponse {
  selfNarrative?: string;
}

export function fallbackSelfNarrativeResponse(): SelfNarrativeResponse {
  return {};
}

export function buildSelfNarrativePrompt(agent: Agent, sinceTick: number): { system: string; user: string } {
  const system = `You are ${agent.label}. Take a step back further than usual and describe yourself, briefly and in your own words — not a list of events or a single takeaway, just how you'd sum yourself up right now if a stranger asked.

Respond ONLY with JSON: {"selfNarrative": a short first-person description of yourself, 1 to 3 sentences}`;

  const currentBlock = agent.selfNarrative
    ? `How you currently describe yourself:\n"${agent.selfNarrative}"\n\n`
    : "You haven't described yourself yet.\n\n";

  const newReflections = agent.reflections
    .filter((r) => r.tick > sinceTick)
    .map((r) => `- ${r.text}`)
    .join('\n');

  const user = `${currentBlock}What you've noticed about yourself lately:
${newReflections || '(nothing new)'}

Update how you'd describe yourself, if anything's actually changed. Keep what still fits.`;

  return { system, user };
}
