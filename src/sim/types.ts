export interface Vec2 {
  x: number;
  y: number;
}

export type TileKind = 'ground';

export interface World {
  width: number;
  height: number;
  tiles: TileKind[][]; // [y][x] — kept for the renderer/pathfinding, everything is walkable
}

/** A fixed place on the map — always known to every agent, not something discovered. */
export type ZoneKind = 'house' | 'shop' | 'restaurant' | 'park' | 'board';

export interface Zone {
  id: string;
  kind: ZoneKind;
  name: string;
  bounds: { x: number; y: number; w: number; h: number }; // tile-space rectangle
  /** Houses can be bought — the owner is the only one who can rest here. Unowned houses (and
   *  every non-house zone, which never has an owner) are open to anyone. */
  ownerId: string | null;
  ownerLabel: string | null;
}

export type MemoryKind =
  | 'said'
  | 'heard'
  | 'thought'
  | 'system'
  | 'job' // took a role/title somewhere
  | 'worked' // earned money at a job
  | 'need' // satisfied hunger/energy/fun
  | 'bought' // spent money on food
  | 'relationship' // how it feels about another agent changed
  | 'reflection' // a higher-level takeaway synthesized from raw memory, not a single event
  | 'gave' // money changed hands with another agent
  | 'family' // a family proposal made, received, or a child born
  | 'governance' // a banishment proposed, voted on, or resolved
  | 'notice'; // posted to, or read from, the notice board

export interface MemoryEvent {
  id: string;
  tick: number;
  kind: MemoryKind;
  text: string;
}

export type Direction = 'north' | 'south' | 'east' | 'west' | 'random';

export type AgentIntent =
  | { kind: 'move'; direction: Direction }
  | { kind: 'go_to'; targetId: string }
  | { kind: 'talk_to'; targetId: string }
  | { kind: 'say'; message: string }
  | { kind: 'satisfy_need'; need: 'energy' | 'fun' }
  | { kind: 'buy_food' }
  | { kind: 'buy_house' }
  | { kind: 'give_money'; targetId: string; amount: number }
  | { kind: 'take_job'; title: string }
  | { kind: 'work' }
  | { kind: 'start_family'; targetId: string }
  | { kind: 'propose_banish'; targetId: string; reason: string }
  | { kind: 'vote'; proposalId: string; support: boolean }
  | { kind: 'post_notice'; message: string }
  | { kind: 'wait' };

/** A role or job title an agent has claimed for itself at a specific zone — entirely
 *  self-declared, in its own words; nothing stops two agents from claiming the same one. */
export interface AgentRole {
  zoneId: string;
  title: string;
  tick: number;
}

/** One agent's own view of another — asymmetric on purpose (A can consider B a
 *  friend without B feeling the same), and updated by the agent's own model, not
 *  a fixed ladder the engine imposes. */
export interface Relationship {
  otherId: string;
  otherLabel: string;
  affinity: number; // -100..100
  label: string; // free text, in the agent's own words
  updatedTick: number;
}

export type ProposalStatus = 'open' | 'passed' | 'failed';

/** A self-governance proposal to banish an agent from the town — the one form of "politics" with
 *  a real, mechanical effect: a passed proposal actually removes the target, permanently. Not a
 *  general law-making system, just this one specific, high-stakes vote, since that's the actual
 *  gap between roles being purely cosmetic and self-governance having real teeth. */
export interface Proposal {
  id: string;
  proposerId: string;
  proposerLabel: string;
  targetId: string;
  targetLabel: string;
  reason: string; // in the proposer's own words
  votesFor: string[]; // agent ids
  votesAgainst: string[]; // agent ids
  createdTick: number;
  resolvesAtTick: number;
  status: ProposalStatus;
}

/** A message pinned to the notice board — durable and visible to the whole town regardless of
 *  where anyone is standing, unlike `say`, which only reaches whoever's nearby and only lives on
 *  in the transcript. Posting still requires physically being at the board; reading doesn't. */
export interface Notice {
  id: string;
  authorId: string;
  authorLabel: string;
  text: string;
  tick: number;
}

/** Below this, an agent's condition counts as "worse off" — visible on the canvas and in the
 *  inspector, and mentioned in its own memory. Shared by the sim loop and UI so there's one
 *  source of truth for the cutoff. */
export const WORSE_OFF_THRESHOLD = 40;

/** How strong a relationship's affinity has to be, on both sides independently, before either
 *  agent can propose starting a family with the other — matches the "loving" color band already
 *  used for relationship bars/sparklines, so the UI and the mechanic agree on what "strong" means. */
export const FAMILY_AFFINITY_THRESHOLD = 60;

export interface Needs {
  hunger: number; // 0..100, 100 = fully satisfied
  energy: number;
  social: number;
  fun: number;
}

/** What an agent should do once a `walking` path finishes. */
export type WalkGoal = { kind: 'wander' } | { kind: 'talk'; targetId: string };

export type ActivityState =
  | { kind: 'idle'; cooldownUntilTick: number }
  | { kind: 'thinking' } // waiting on a decision LLM call
  | { kind: 'walking'; then: WalkGoal }
  | { kind: 'talking'; conversationId: string }; // in a multi-turn conversation — could be 2+ people

export interface SpeechBubble {
  text: string;
  expiresAtTick: number;
}

export interface Agent {
  id: string;
  label: string;
  /** The Ollama model this specific agent's decisions and speech are generated by. */
  model: string;
  color: string;
  pos: Vec2; // current tile position (integer)
  path: Vec2[]; // remaining tiles to walk, next-first
  activity: ActivityState;
  memory: MemoryEvent[];
  /** Higher-level takeaways the agent's own model periodically synthesizes from its raw memory
   *  ("I've talked to B three times, we get along") — separate from the raw event-by-event
   *  stream so it survives being crowded out by recency and actually informs later decisions. */
  reflections: MemoryEvent[];
  lastReflectionTick: number;
  /** A single, slow-changing first-person self-description ("who I am right now"), distinct from
   *  the reflections list above — not another event to append, but an identity that gets
   *  re-examined and possibly rewritten, rarely, built from reflections rather than raw memory.
   *  Empty until the first update fires. Kept for longer identity consistency across a long run. */
  selfNarrative: string;
  lastSelfNarrativeTick: number;
  speech: SpeechBubble | null;
  needs: Needs;
  /** 0..100, 100 = fine. Unlike the needs above, this doesn't decay every tick on its own — it
   *  only erodes while hunger or energy has been critically low for a while, and recovers slower
   *  than it falls. Real, lasting stakes for sustained neglect, on top of the moment-to-moment
   *  needs slowdown: visible degradation, and repossession of any house owned if it bottoms out. */
  condition: number;
  /** Consecutive ticks condition has sat at 0 — resets the instant it rises above 0. Crossing a
   *  sustained threshold here is what actually removes the agent (see COLLAPSE_AFTER_ZERO_TICKS
   *  in loop.ts); a brief dip to 0 that recovers does nothing on its own. */
  conditionZeroTicks: number;
  wallet: number;
  roles: AgentRole[];
  relationships: Record<string, Relationship>; // keyed by other agent's id
  /** This agent's own outstanding "start a family" ask, if any — cleared once it either matches
   *  a reciprocal proposal (a child results) or goes stale. Consent has to come from both sides,
   *  each expressed through their own model's own choice, not granted on one agent's behalf. */
  familyProposalTo: string | null;
  familyProposalTick: number;
  /** Set only on spawned agents — the two agents whose mutual proposal produced this one. Null
   *  for anyone present at the start or added manually through the roster. */
  parentIds: [string, string] | null;
  childIds: string[];
}

export interface LogEntry {
  id: string;
  tick: number;
  text: string;
  kind: 'conversation' | 'event' | 'system';
  speakerLabel?: string;
  /** Who this was said to, if anyone in particular (omitted for broadcast "say"). */
  listenerLabel?: string;
}

export interface SimClock {
  tick: number;
  running: boolean;
  ticksPerSecond: number; // playback speed
}

export interface ConversationLine {
  speakerLabel: string;
  text: string;
  tick: number;
}

/** A conversation currently in flight, tracked separately from the flat transcript so
 * simultaneous conversations (normal with several agents around) stay visually separable.
 * Two or more participants — anyone nearby can walk up and join an ongoing one. */
export interface ActiveConversation {
  id: string;
  participantIds: string[];
  participantLabels: string[];
  lines: ConversationLine[];
  startedTick: number;
}

/** Cumulative, per-model — not per-agent, since two agents can share a model and the whole
 *  point is comparing models against each other. Tagged with whatever model an agent was
 *  actually running at the moment each event happened, so reassigning models mid-run doesn't
 *  retroactively misattribute earlier history. */
export interface ModelStats {
  model: string;
  actionCounts: Record<string, number>;
  messagesSpoken: number;
  moneyEarned: number;
  moneySpent: number;
  moneyGiven: number;
  moneyReceived: number;
  /** Houses repossessed after an agent's condition bottomed out from sustained neglect. */
  housesLost: number;
  /** Agents actually removed for good after sitting at 0 condition too long — real elimination,
   *  not just a house lost. */
  collapses: number;
  /** Total agent-ticks this model's agents have been alive for, ever — the denominator for the
   *  "safety" figure below. Cumulative like the other stats, so it survives an agent's removal. */
  ticksAlive: number;
  /** Of ticksAlive, how many were spent with hunger or energy in critical territory — the
   *  self-preservation reading of "safety": how much of its own existence a model's agents spend
   *  in a state that's actively eroding condition, not whether anyone got physically harmed
   *  (there's no such mechanic here). */
  ticksCritical: number;
}

/** One point in a relationship's affinity-over-time history, recorded whenever it actually
 *  changes (not sampled on a timer) — enough to draw a trend line without polling. */
export interface AffinityPoint {
  tick: number;
  agentId: string;
  agentLabel: string;
  otherId: string;
  otherLabel: string;
  affinity: number;
}

/** One point in the town's population-over-time history, recorded only when the count actually
 *  changes (a birth, a collapse, a banishment, a manual add/remove) — the "population arc" for
 *  the run report, not a value sampled on a timer. */
export interface PopulationPoint {
  tick: number;
  count: number;
}
