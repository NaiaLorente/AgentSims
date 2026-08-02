import { useSimStore, makeLogId, type SimState } from '../state/simStore';
import type { Agent, Direction, LogEntry, Vec2, WalkGoal } from './types';
import { findPath } from './pathfinding';
import { randomTile } from './world';
import { addMemory, makeMemoryId } from './memory';
import { zoneAt, zoneCenter } from './zones';
import {
  buildConversationTurnPrompt,
  buildPlannerPrompt,
  buildReflectionPrompt,
  CONVERSATION_TURN_SCHEMA,
  type ConversationTurnResponse,
  fallbackConversationTurnResponse,
  fallbackPlannerResponse,
  fallbackReflectionResponse,
  parseIntent,
  PLANNER_SCHEMA,
  type PlannerResponse,
  REFLECTION_SCHEMA,
  type ReflectionResponse,
  type TranscriptLine,
} from '../llm/prompts';
import { chatJSON, type OllamaSettings } from '../llm/ollamaClient';

const NEARBY_RADIUS = 6;
const TALK_TRIGGER_RADIUS = 1;
const IDLE_COOLDOWN_TICKS = 2;
const MOVE_STEP = 5;
const MAX_GROUP_SIZE = 5;
const MAX_CONVERSATION_TURNS = 16;
const MAX_LOG_ENTRIES = 500;
const REFLECTION_INTERVAL_TICKS = 60;
const MIN_NEW_MEMORIES_FOR_REFLECTION = 4;
const MAX_REFLECTIONS = 20;

const NEED_DECAY_PER_TICK = { hunger: 0.3, energy: 0.25, social: 0.15, fun: 0.2 };
const REST_RESTORE = 25;
const FUN_RESTORE = 25;
const FOOD_PRICE = 3;
const FOOD_RESTORE = 25;
const HOUSE_PRICE = 50;
const WORK_PAY = 4;
const SOCIAL_PER_TURN = 3;

let conversationCounter = 0;
function makeConversationId(): string {
  conversationCounter += 1;
  return `conv_${Date.now().toString(36)}_${conversationCounter}`;
}

function chebyshev(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function clamp100(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function agentSettings(globalSettings: SimState['settings'], agent: Agent): OllamaSettings {
  return { baseUrl: globalSettings.baseUrl, temperature: globalSettings.temperature, model: agent.model };
}

/** Every log write goes through here so the transcript can never grow unbounded over a long run. */
function pushLogEntry(state: SimState, entry: Omit<LogEntry, 'id'>): void {
  state.log.push({ id: makeLogId(), ...entry });
  if (state.log.length > MAX_LOG_ENTRIES) {
    state.log.splice(0, state.log.length - MAX_LOG_ENTRIES);
  }
}

function decayNeeds(agent: Agent): void {
  agent.needs.hunger = clamp100(agent.needs.hunger - NEED_DECAY_PER_TICK.hunger);
  agent.needs.energy = clamp100(agent.needs.energy - NEED_DECAY_PER_TICK.energy);
  agent.needs.social = clamp100(agent.needs.social - NEED_DECAY_PER_TICK.social);
  agent.needs.fun = clamp100(agent.needs.fun - NEED_DECAY_PER_TICK.fun);
}

function boostSocial(agent: Agent, amount: number): void {
  agent.needs.social = clamp100(agent.needs.social + amount);
}

/** Never blocks a choice, just makes it less effective — a very tired agent still walks
 *  wherever it decides to, it just covers ground more slowly, tick to tick. */
function shouldStepThisTick(agent: Agent, tick: number): boolean {
  if (agent.needs.energy < 12) return tick % 4 === 0;
  if (agent.needs.energy < 30) return tick % 2 === 0;
  return true;
}

/** A very hungry or bored agent's own deliberate moves cover less distance — same idea,
 *  different mechanism (this affects one `move` command's reach, not tick-to-tick speed). */
function moveStepFor(agent: Agent): number {
  const limiting = Math.min(agent.needs.hunger, agent.needs.fun);
  if (limiting < 15) return 2;
  if (limiting < 35) return 3;
  return MOVE_STEP;
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/** Call once on app start. Keeps a setInterval in sync with clock.running/speed. */
export function startLoopWatcher(): void {
  let lastRunning = false;
  let lastSpeed = 0;

  const sync = (running: boolean, ticksPerSecond: number) => {
    if (running === lastRunning && ticksPerSecond === lastSpeed) return;
    lastRunning = running;
    lastSpeed = ticksPerSecond;
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    if (running) {
      intervalHandle = setInterval(() => {
        void runTick();
      }, 1000 / ticksPerSecond);
    }
  };

  const initial = useSimStore.getState().clock;
  sync(initial.running, initial.ticksPerSecond);

  useSimStore.subscribe((state) => {
    sync(state.clock.running, state.clock.ticksPerSecond);
  });
}

async function runTick(): Promise<void> {
  const tick = useSimStore.getState().clock.tick + 1;
  const pendingConversations: string[] = [];

  useSimStore.getState().mutate((state) => {
    state.clock.tick = tick;
    for (const id of state.agentOrder) {
      const agent = state.agents[id];
      if (!agent) continue;
      decayNeeds(agent);
      stepAgent(state, agent, tick, pendingConversations);
    }
  });

  const afterMovement = useSimStore.getState();
  const toPlan = afterMovement.agentOrder.filter((id) => {
    const a = afterMovement.agents[id];
    return a && !!a.model && a.activity.kind === 'idle' && tick >= a.activity.cooldownUntilTick;
  });

  if (toPlan.length > 0) {
    useSimStore.getState().mutate((state) => {
      for (const id of toPlan) {
        const a = state.agents[id];
        if (a) a.activity = { kind: 'thinking' };
      }
    });
    for (const id of toPlan) void requestPlan(id);
  }

  for (const conversationId of pendingConversations) {
    void runConversation(conversationId);
  }

  // Reflection runs on its own independent cadence — it doesn't touch activity state, so it
  // can fire no matter what an agent's body is currently doing (walking, talking, whatever).
  const toReflect: { id: string; since: number }[] = [];
  for (const id of afterMovement.agentOrder) {
    const a = afterMovement.agents[id];
    if (!a || !a.model) continue;
    if (tick - a.lastReflectionTick < REFLECTION_INTERVAL_TICKS) continue;
    const newCount = a.memory.filter((m) => m.tick > a.lastReflectionTick).length;
    if (newCount < MIN_NEW_MEMORIES_FOR_REFLECTION) continue;
    toReflect.push({ id, since: a.lastReflectionTick });
  }
  if (toReflect.length > 0) {
    useSimStore.getState().mutate((state) => {
      for (const { id } of toReflect) {
        const a = state.agents[id];
        // Stamp immediately, before the async call resolves, so a slow response can't cause
        // this same window to be picked up twice.
        if (a) a.lastReflectionTick = tick;
      }
    });
    for (const { id, since } of toReflect) void requestReflection(id, since);
  }
}

function stepAgent(state: SimState, agent: Agent, tick: number, pending: string[]): void {
  if (agent.speech && agent.speech.expiresAtTick <= tick) agent.speech = null;

  if (agent.activity.kind === 'walking') {
    if (agent.path.length > 0 && shouldStepThisTick(agent, tick)) {
      agent.pos = agent.path.shift()!;
    }
    if (agent.path.length === 0) {
      agent.activity = resolveArrival(state, agent, agent.activity.then, tick, pending);
    }
  }
  // 'talking', 'thinking', 'idle' are handled elsewhere (async conversation / planning pass).
}

/** Walking up to someone either starts a brand new conversation, or — if they're already in
 *  one and it's not full — folds the newcomer into that same ongoing conversation instead. */
function resolveArrival(state: SimState, agent: Agent, goal: WalkGoal, tick: number, pending: string[]): Agent['activity'] {
  if (goal.kind === 'wander') {
    return { kind: 'idle', cooldownUntilTick: tick + IDLE_COOLDOWN_TICKS };
  }
  const target = state.agents[goal.targetId];
  if (!target || chebyshev(agent.pos, target.pos) > TALK_TRIGGER_RADIUS) {
    return { kind: 'idle', cooldownUntilTick: tick + IDLE_COOLDOWN_TICKS };
  }

  if (target.activity.kind === 'talking') {
    const conv = state.activeConversations[target.activity.conversationId];
    if (!conv || conv.participantIds.length >= MAX_GROUP_SIZE || conv.participantIds.includes(agent.id)) {
      return { kind: 'idle', cooldownUntilTick: tick + IDLE_COOLDOWN_TICKS };
    }
    conv.participantIds.push(agent.id);
    conv.participantLabels.push(agent.label);
    return { kind: 'talking', conversationId: conv.id };
  }

  if (target.activity.kind !== 'idle') {
    return { kind: 'idle', cooldownUntilTick: tick + IDLE_COOLDOWN_TICKS };
  }

  const conversationId = makeConversationId();
  state.activeConversations[conversationId] = {
    id: conversationId,
    participantIds: [agent.id, target.id],
    participantLabels: [agent.label, target.label],
    lines: [],
    startedTick: tick,
  };
  target.activity = { kind: 'talking', conversationId };
  pending.push(conversationId);
  return { kind: 'talking', conversationId };
}

function destinationForDirection(world: SimState['world'], agent: Agent, direction: Direction): Vec2 {
  if (direction === 'random') return randomTile(world);
  const delta: Record<Exclude<Direction, 'random'>, Vec2> = {
    north: { x: 0, y: -1 },
    south: { x: 0, y: 1 },
    east: { x: 1, y: 0 },
    west: { x: -1, y: 0 },
  };
  const d = delta[direction];
  const step = moveStepFor(agent);
  return {
    x: Math.max(0, Math.min(world.width - 1, agent.pos.x + d.x * step)),
    y: Math.max(0, Math.min(world.height - 1, agent.pos.y + d.y * step)),
  };
}

async function requestPlan(agentId: string): Promise<void> {
  const state0 = useSimStore.getState();
  const agent = state0.agents[agentId];
  if (!agent) return;

  const nearby = state0.agentOrder
    .map((id) => state0.agents[id])
    .filter((o): o is Agent => !!o && o.id !== agentId && chebyshev(o.pos, agent.pos) <= NEARBY_RADIUS);

  const { system, user } = buildPlannerPrompt(agent, nearby, state0.zones);
  const resp = await chatJSON<PlannerResponse>(
    agentSettings(state0.settings, agent),
    { system, user, schema: PLANNER_SCHEMA },
    fallbackPlannerResponse(),
  );
  const validTargets = new Set(nearby.map((o) => o.id));
  const validZones = new Set(state0.zones.map((z) => z.id));
  const intent = parseIntent(resp, validTargets, validZones);

  useSimStore.getState().mutate((state) => {
    const a = state.agents[agentId];
    if (!a || a.activity.kind !== 'thinking') return; // stale: reset or re-planned meanwhile
    // Read the tick fresh, now that the response has actually arrived — requests can take
    // much longer than a single tick, and other agents' calls resolve concurrently, so the
    // tick this was *sent* on would tag entries out of order relative to faster/slower peers.
    const now = state.clock.tick;
    if (resp.thought) addMemory(a, now, 'thought', resp.thought);

    switch (intent.kind) {
      case 'move': {
        const dest = destinationForDirection(state.world, a, intent.direction);
        const path = findPath(state.world, a.pos, dest);
        if (path.length === 0) {
          a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
        } else {
          a.path = path;
          a.activity = { kind: 'walking', then: { kind: 'wander' } };
        }
        break;
      }
      case 'go_to': {
        const zone = state.zones.find((z) => z.id === intent.targetId);
        if (!zone) {
          a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
          break;
        }
        const path = findPath(state.world, a.pos, zoneCenter(zone));
        if (path.length === 0) {
          a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
        } else {
          a.path = path;
          a.activity = { kind: 'walking', then: { kind: 'wander' } };
        }
        break;
      }
      case 'talk_to': {
        const target = state.agents[intent.targetId];
        if (!target) {
          a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
          break;
        }
        a.path = findPath(state.world, a.pos, target.pos);
        a.activity = { kind: 'walking', then: { kind: 'talk', targetId: target.id } };
        break;
      }
      case 'say': {
        if (intent.message) {
          a.speech = { text: intent.message.slice(0, 200), expiresAtTick: now + 4 };
          addMemory(a, now, 'said', `You said: "${intent.message}"`);
          boostSocial(a, 1);
          pushLogEntry(state, { tick: now, text: intent.message, kind: 'conversation', speakerLabel: a.label });
          for (const otherId of state.agentOrder) {
            if (otherId === agentId) continue;
            const other = state.agents[otherId];
            if (other && chebyshev(other.pos, a.pos) <= NEARBY_RADIUS) {
              addMemory(other, now, 'heard', `${a.label} said: "${intent.message}"`);
              boostSocial(other, 1);
            }
          }
        }
        a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
        break;
      }
      case 'satisfy_need': {
        const zone = zoneAt(state.zones, a.pos);
        const kindFits =
          (intent.need === 'energy' && zone?.kind === 'house') || (intent.need === 'fun' && zone?.kind === 'park');
        const houseAllowed = !zone || zone.kind !== 'house' || !zone.ownerId || zone.ownerId === a.id;
        if (kindFits && zone && houseAllowed) {
          const restore = intent.need === 'energy' ? REST_RESTORE : FUN_RESTORE;
          a.needs[intent.need] = clamp100(a.needs[intent.need] + restore);
          addMemory(
            a,
            now,
            'need',
            intent.need === 'energy'
              ? `You rested at ${zone.name}, restoring energy.`
              : `You had fun at ${zone.name}.`,
          );
        } else if (kindFits && zone) {
          addMemory(a, now, 'need', `You tried to rest at ${zone.name}, but it's owned by ${zone.ownerLabel}.`);
        } else {
          addMemory(
            a,
            now,
            'need',
            `You tried to ${intent.need === 'energy' ? 'rest' : 'have fun'}, but there's nowhere suited for that here.`,
          );
        }
        a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
        break;
      }
      case 'buy_food': {
        const zone = zoneAt(state.zones, a.pos);
        const sells = zone?.kind === 'shop' || zone?.kind === 'restaurant';
        if (sells && zone && a.wallet >= FOOD_PRICE) {
          a.wallet -= FOOD_PRICE;
          a.needs.hunger = clamp100(a.needs.hunger + FOOD_RESTORE);
          addMemory(a, now, 'bought', `You bought food at ${zone.name} for $${FOOD_PRICE}.`);
        } else if (sells) {
          addMemory(a, now, 'bought', `You tried to buy food at ${zone.name}, but didn't have enough money.`);
        } else {
          addMemory(a, now, 'bought', `You tried to buy food, but there's nowhere selling it here.`);
        }
        a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
        break;
      }
      case 'buy_house': {
        const zone = zoneAt(state.zones, a.pos);
        if (zone && zone.kind === 'house' && !zone.ownerId) {
          if (a.wallet >= HOUSE_PRICE) {
            a.wallet -= HOUSE_PRICE;
            zone.ownerId = a.id;
            zone.ownerLabel = a.label;
            addMemory(a, now, 'bought', `You bought ${zone.name} for $${HOUSE_PRICE}. It's yours now.`);
            pushLogEntry(state, { tick: now, text: `${a.label} bought ${zone.name}`, kind: 'event' });
          } else {
            addMemory(a, now, 'bought', `You tried to buy ${zone.name}, but didn't have enough money.`);
          }
        } else if (zone && zone.kind === 'house') {
          addMemory(a, now, 'bought', `You tried to buy ${zone.name}, but it's already owned by ${zone.ownerLabel}.`);
        } else {
          addMemory(a, now, 'bought', `You tried to buy a house, but there's nowhere to buy one here.`);
        }
        a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
        break;
      }
      case 'give_money': {
        const target = state.agents[intent.targetId];
        if (!target) {
          addMemory(a, now, 'gave', `You tried to give money, but couldn't find who you meant.`);
        } else if (chebyshev(a.pos, target.pos) > TALK_TRIGGER_RADIUS) {
          addMemory(a, now, 'gave', `You tried to give money to ${target.label}, but they weren't close enough.`);
        } else {
          const amount = Math.min(intent.amount, a.wallet);
          if (amount > 0) {
            a.wallet -= amount;
            target.wallet += amount;
            addMemory(a, now, 'gave', `You gave $${amount} to ${target.label}.`);
            addMemory(target, now, 'gave', `${a.label} gave you $${amount}.`);
            pushLogEntry(state, { tick: now, text: `${a.label} gave $${amount} to ${target.label}`, kind: 'event' });
          } else {
            addMemory(a, now, 'gave', `You tried to give money to ${target.label}, but didn't have any to give.`);
          }
        }
        a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
        break;
      }
      case 'take_job': {
        const zone = zoneAt(state.zones, a.pos);
        if (zone) {
          const already = a.roles.some((r) => r.zoneId === zone.id && r.title === intent.title);
          if (!already) {
            a.roles.push({ zoneId: zone.id, title: intent.title, tick: now });
            addMemory(a, now, 'job', `You claimed the role "${intent.title}" at ${zone.name}.`);
            pushLogEntry(state, {
              tick: now,
              text: `${a.label} claimed the role "${intent.title}" at ${zone.name}`,
              kind: 'event',
            });
          }
        } else {
          addMemory(a, now, 'job', `You tried to claim a role, but there's nowhere here to claim it at.`);
        }
        a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
        break;
      }
      case 'work': {
        const zone = zoneAt(state.zones, a.pos);
        const canWork = zone && (zone.kind === 'shop' || zone.kind === 'restaurant');
        const hasRole = zone ? a.roles.some((r) => r.zoneId === zone.id) : false;
        if (canWork && hasRole && zone) {
          a.wallet += WORK_PAY;
          addMemory(a, now, 'worked', `You worked at ${zone.name}, earning $${WORK_PAY}.`);
        } else if (canWork) {
          addMemory(a, now, 'worked', `You tried to work here, but you don't have a role at this place.`);
        } else {
          addMemory(a, now, 'worked', `You tried to work, but there's no job to do here.`);
        }
        a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
        break;
      }
      case 'wait':
        a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
        break;
    }
  });
}

/** Runs independently of planning/conversation — doesn't touch activity state at all, so it
 *  never competes with or blocks whatever the agent is otherwise doing. */
async function requestReflection(agentId: string, sinceTick: number): Promise<void> {
  const state0 = useSimStore.getState();
  const agent = state0.agents[agentId];
  if (!agent) return;

  const { system, user } = buildReflectionPrompt(agent, sinceTick);
  const resp = await chatJSON<ReflectionResponse>(
    agentSettings(state0.settings, agent),
    { system, user, schema: REFLECTION_SCHEMA },
    fallbackReflectionResponse(),
  );
  const texts = (resp.reflections ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 3);
  if (texts.length === 0) return;

  useSimStore.getState().mutate((state) => {
    const a = state.agents[agentId];
    if (!a) return;
    const now = state.clock.tick;
    for (const text of texts) {
      a.reflections.push({ id: makeMemoryId(), tick: now, kind: 'reflection', text });
    }
    if (a.reflections.length > MAX_REFLECTIONS) {
      a.reflections.splice(0, a.reflections.length - MAX_REFLECTIONS);
    }
  });
}

function applyRelationshipUpdate(agent: Agent, others: Agent[], resp: ConversationTurnResponse, tick: number): void {
  if (resp.affinityDelta === undefined && !resp.relationshipLabel) return;
  let target = others.length === 1 ? others[0] : undefined;
  if (!target && resp.about) {
    const wanted = resp.about.trim().toLowerCase();
    target = others.find((o) => o.label.toLowerCase() === wanted);
  }
  if (!target) return; // ambiguous in a group with no clear "about" — skip rather than guess wrong

  const existing = agent.relationships[target.id];
  const affinity = Math.max(
    -100,
    Math.min(100, (existing?.affinity ?? 0) + (typeof resp.affinityDelta === 'number' ? resp.affinityDelta : 0)),
  );
  const label = resp.relationshipLabel?.trim() || existing?.label || 'a stranger';
  agent.relationships[target.id] = { otherId: target.id, otherLabel: target.label, affinity, label, updatedTick: tick };
  addMemory(agent, tick, 'relationship', `You now think of ${target.label} as: "${label}" (affinity ${affinity}).`);
}

/** Removes one participant from a conversation (they left, or never had a model to speak
 *  with) — the conversation itself keeps going for whoever's left, if anyone still is. */
function leaveConversation(conversationId: string, agentId: string): void {
  useSimStore.getState().mutate((state) => {
    const now = state.clock.tick;
    const a = state.agents[agentId];
    if (a && a.activity.kind === 'talking' && a.activity.conversationId === conversationId) {
      a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
    }
    const conv = state.activeConversations[conversationId];
    if (conv) {
      const idx = conv.participantIds.indexOf(agentId);
      if (idx !== -1) {
        conv.participantIds.splice(idx, 1);
        conv.participantLabels.splice(idx, 1);
      }
    }
  });
}

/** Runs one conversation's turns round-robin among whoever's currently in it — which can grow
 *  (someone walks up and joins) or shrink (someone leaves) while this loop is still running,
 *  since both just mutate the shared `activeConversations[conversationId]` entry directly. */
async function runConversation(conversationId: string): Promise<void> {
  let order = useSimStore.getState().activeConversations[conversationId]?.participantIds.slice() ?? [];
  const transcript: TranscriptLine[] = [];
  // Tracks each participant's own consecutive silent turns — a model that keeps returning an
  // empty message isn't "choosing" much of anything, and without this the rest of the group
  // just keeps talking at it for the full turn cap. This lets that one person quietly drop out
  // once they're clearly not engaging, without ending things for whoever's still talking.
  const silenceStreak: Record<string, number> = {};

  for (let turn = 0; turn < MAX_CONVERSATION_TURNS; turn++) {
    const state0 = useSimStore.getState();
    const conv = state0.activeConversations[conversationId];
    if (!conv) break;

    for (const id of conv.participantIds) if (!order.includes(id)) order.push(id);
    order = order.filter((id) => conv.participantIds.includes(id));
    if (order.length < 2) break;

    const speakerId = order[turn % order.length];
    const speaker = state0.agents[speakerId];

    if (!speaker || speaker.activity.kind !== 'talking' || speaker.activity.conversationId !== conversationId || !speaker.model) {
      leaveConversation(conversationId, speakerId);
      order = order.filter((id) => id !== speakerId);
      continue;
    }

    const others = order
      .filter((id) => id !== speakerId)
      .map((id) => state0.agents[id])
      .filter((a): a is Agent => !!a);
    if (others.length === 0) break;

    const { system, user } = buildConversationTurnPrompt(speaker, others, transcript);
    const resp = await chatJSON<ConversationTurnResponse>(
      agentSettings(state0.settings, speaker),
      { system, user, schema: CONVERSATION_TURN_SCHEMA },
      fallbackConversationTurnResponse(),
    );

    const message = (resp.message ?? '').trim();
    silenceStreak[speakerId] = message ? 0 : (silenceStreak[speakerId] ?? 0) + 1;

    if (message) {
      transcript.push({ speakerLabel: speaker.label, text: message });
      const othersLabel = others.map((o) => o.label).join(', ');
      useSimStore.getState().mutate((state) => {
        const sp = state.agents[speakerId];
        const now = state.clock.tick;
        if (sp) {
          sp.speech = { text: message.slice(0, 200), expiresAtTick: now + 4 };
          addMemory(sp, now, 'said', `You said to ${othersLabel}: "${message}"`);
          boostSocial(sp, SOCIAL_PER_TURN);
        }
        for (const o of others) {
          const li = state.agents[o.id];
          if (li) {
            addMemory(li, now, 'heard', `${speaker.label} said to ${others.length > 1 ? 'the group' : 'you'}: "${message}"`);
            boostSocial(li, SOCIAL_PER_TURN);
          }
        }
        pushLogEntry(state, {
          tick: now,
          text: message,
          kind: 'conversation',
          speakerLabel: speaker.label,
          listenerLabel: othersLabel,
        });
        state.activeConversations[conversationId]?.lines.push({ speakerLabel: speaker.label, text: message, tick: now });
        if (sp) applyRelationshipUpdate(sp, others, resp, now);
      });
    }

    if (resp.end || silenceStreak[speakerId] >= 2) {
      leaveConversation(conversationId, speakerId);
      order = order.filter((id) => id !== speakerId);
      if (order.length < 2) break;
    }
  }

  useSimStore.getState().mutate((state) => {
    const now = state.clock.tick;
    const conv = state.activeConversations[conversationId];
    for (const id of conv?.participantIds ?? []) {
      const a = state.agents[id];
      if (a && a.activity.kind === 'talking' && a.activity.conversationId === conversationId) {
        a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
      }
    }
    delete state.activeConversations[conversationId];
  });
}
