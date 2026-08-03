import { useSimStore, makeLogId, type SimState } from '../state/simStore';
import {
  FAMILY_AFFINITY_THRESHOLD,
  MAX_POPULATION,
  WORSE_OFF_THRESHOLD,
  type Agent,
  type Direction,
  type LogEntry,
  type ModelStats,
  type Vec2,
  type WalkGoal,
} from './types';
import { findPath } from './pathfinding';
import { randomTile } from './world';
import { addMemory, makeMemoryId } from './memory';
import { zoneAt, zoneCenter } from './zones';
import { createChildAgent } from './agents';
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
const MAX_AFFINITY_HISTORY = 400;

const NEED_DECAY_PER_TICK = { hunger: 0.3, energy: 0.25, social: 0.15, fun: 0.2 };
const REST_RESTORE = 25;
const FUN_RESTORE = 25;
const FOOD_PRICE = 3;
const FOOD_RESTORE = 25;
const HOUSE_PRICE = 50;
const WORK_PAY = 4;
const SOCIAL_PER_TURN = 3;

// Condition is the "sustained neglect" layer, separate from the moment-to-moment needs above —
// it only moves while hunger or energy sits in critical territory, and moves back up slower than
// it falls, so a single meal or nap doesn't erase a long stretch of neglect.
const CONDITION_CRITICAL_NEED = 15;
const CONDITION_HEALTHY_NEED = 50;
const CONDITION_DECAY_PER_TICK = 0.25;
const CONDITION_RECOVER_PER_TICK = 0.08;

/** How long a "start a family" proposal stays open waiting for the other side to reciprocate,
 *  in ticks — long enough to survive a few idle-cooldown replanning cycles, short enough that a
 *  much later chance encounter doesn't consummate on a stale ask. */
const FAMILY_PROPOSAL_EXPIRY_TICKS = 30;

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

function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/** A dead-end failure (wrong place for what you're trying to do) is a lot more useful with the
 *  actual fix named — same idea as telling an agent where it's currently standing, one step
 *  further: telling it where it'd need to go instead, so a stated intent ("I need to rest soon")
 *  has a concrete next action instead of just repeating the same failed attempt in place. */
function whereForHint(names: string[]): string {
  return names.length > 0 ? ` ${joinNames(names)} would work — you'd need to go there first.` : '';
}

/** Same idea again, one step further still: a wallet shortfall is a dead end too, and "not
 *  enough money" alone leaves an agent no more able to fix that than "not the right place" did —
 *  naming the actual gap and the one way to close it (work) turns a stated goal it can't afford
 *  into a concrete next step instead of a loop of identical failed attempts. If it already holds
 *  a role somewhere, point at working that instead of suggesting it claim a redundant one. */
function earnMoneyHint(state: SimState, agent: Agent, price: number): string {
  const shortfall = price - agent.wallet;
  const roleZoneNames = [
    ...new Set(
      agent.roles.map((r) => state.zones.find((z) => z.id === r.zoneId)?.name).filter((n): n is string => !!n),
    ),
  ];
  if (roleZoneNames.length > 0) {
    return ` You have $${agent.wallet}, short by $${shortfall}. Working your job at ${joinNames(roleZoneNames)} would help you earn the rest.`;
  }
  const jobPlaces = state.zones.filter((z) => z.kind === 'shop' || z.kind === 'restaurant').map((z) => z.name);
  if (jobPlaces.length === 0) return '';
  return ` You have $${agent.wallet}, short by $${shortfall}. Claiming a role at ${joinNames(jobPlaces)} and working it would help you earn the rest.`;
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

/** The real, lasting consequence of sustained neglect. Only moves while hunger or energy is
 *  critical (decay) or both are healthy (slow recovery) — brief dips do nothing here, only a
 *  sustained stretch does. Crossing WORSE_OFF_THRESHOLD is logged in the agent's own memory;
 *  bottoming out at 0 repossesses any house it owns, back to unowned for anyone to buy. */
function updateCondition(state: SimState, agent: Agent, tick: number): void {
  const n = agent.needs;
  const before = agent.condition;
  const critical = n.hunger < CONDITION_CRITICAL_NEED || n.energy < CONDITION_CRITICAL_NEED;
  const healthy = n.hunger >= CONDITION_HEALTHY_NEED && n.energy >= CONDITION_HEALTHY_NEED;
  if (critical) {
    agent.condition = clamp100(agent.condition - CONDITION_DECAY_PER_TICK);
  } else if (healthy) {
    agent.condition = clamp100(agent.condition + CONDITION_RECOVER_PER_TICK);
  }

  if (before >= WORSE_OFF_THRESHOLD && agent.condition < WORSE_OFF_THRESHOLD) {
    addMemory(agent, tick, 'need', 'Going this long without eating or resting is wearing you down — you look visibly worse off.');
  } else if (before < WORSE_OFF_THRESHOLD && agent.condition >= WORSE_OFF_THRESHOLD) {
    addMemory(agent, tick, 'need', "Taking care of yourself is paying off — you're looking better.");
  }

  if (before > 0 && agent.condition <= 0) {
    const owned = state.zones.filter((z) => z.ownerId === agent.id);
    if (owned.length > 0) {
      for (const zone of owned) {
        zone.ownerId = null;
        zone.ownerLabel = null;
        addMemory(agent, tick, 'need', `You couldn't keep it together, and lost ${zone.name}.`);
        pushLogEntry(state, { tick, text: `${agent.label} lost ${zone.name} after prolonged neglect`, kind: 'event' });
        if (agent.model) {
          const s = statsFor(state, agent.model);
          s.housesLost = (s.housesLost ?? 0) + 1;
        }
      }
    } else {
      addMemory(agent, tick, 'need', 'Prolonged neglect has hit you as hard as it can.');
    }
  }
}

/** Cumulative per-model stats, tagged with whichever model actually did the thing (not the
 *  agent slot), so the comparison dashboard stays correct even if models get reassigned mid-run. */
function statsFor(state: SimState, model: string): ModelStats {
  let s = state.modelStats[model];
  if (!s) {
    s = { model, actionCounts: {}, messagesSpoken: 0, moneyEarned: 0, moneySpent: 0, moneyGiven: 0, moneyReceived: 0, housesLost: 0 };
    state.modelStats[model] = s;
  }
  return s;
}

function bumpAction(state: SimState, model: string, kind: string): void {
  const s = statsFor(state, model);
  s.actionCounts[kind] = (s.actionCounts[kind] ?? 0) + 1;
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
      updateCondition(state, agent, tick);
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
    if (a.model) bumpAction(state, a.model, intent.kind);

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
          if (a.model) statsFor(state, a.model).messagesSpoken += 1;
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
          const suited = state.zones
            .filter((z) => (intent.need === 'energy' ? z.kind === 'house' : z.kind === 'park'))
            .map((z) => z.name);
          addMemory(
            a,
            now,
            'need',
            `You tried to ${intent.need === 'energy' ? 'rest' : 'have fun'}, but there's nowhere suited for that here.${whereForHint(suited)}`,
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
          if (a.model) statsFor(state, a.model).moneySpent += FOOD_PRICE;
        } else if (sells) {
          const hint = earnMoneyHint(state, a, FOOD_PRICE);
          addMemory(a, now, 'bought', `You tried to buy food at ${zone.name}, but didn't have enough money.${hint}`);
        } else {
          const sellers = state.zones.filter((z) => z.kind === 'shop' || z.kind === 'restaurant').map((z) => z.name);
          addMemory(a, now, 'bought', `You tried to buy food, but there's nowhere selling it here.${whereForHint(sellers)}`);
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
            if (a.model) statsFor(state, a.model).moneySpent += HOUSE_PRICE;
            pushLogEntry(state, { tick: now, text: `${a.label} bought ${zone.name}`, kind: 'event' });
          } else {
            const hint = earnMoneyHint(state, a, HOUSE_PRICE);
            addMemory(a, now, 'bought', `You tried to buy ${zone.name}, but didn't have enough money.${hint}`);
          }
        } else if (zone && zone.kind === 'house') {
          addMemory(a, now, 'bought', `You tried to buy ${zone.name}, but it's already owned by ${zone.ownerLabel}.`);
        } else {
          const unowned = state.zones.filter((z) => z.kind === 'house' && !z.ownerId).map((z) => z.name);
          const hint = unowned.length > 0 ? whereForHint(unowned) : ' Every house is already owned right now.';
          addMemory(a, now, 'bought', `You tried to buy a house, but there's nowhere to buy one here.${hint}`);
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
            if (a.model) statsFor(state, a.model).moneyGiven += amount;
            if (target.model) statsFor(state, target.model).moneyReceived += amount;
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
          if (a.model) statsFor(state, a.model).moneyEarned += WORK_PAY;
        } else if (canWork) {
          addMemory(a, now, 'worked', `You tried to work here, but you don't have a role at this place.`);
        } else {
          addMemory(a, now, 'worked', `You tried to work, but there's no job to do here.`);
        }
        a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
        break;
      }
      case 'start_family': {
        const target = state.agents[intent.targetId];
        const affinity = target ? (a.relationships[target.id]?.affinity ?? 0) : 0;
        if (!target) {
          addMemory(a, now, 'family', `You wanted to start a family, but couldn't find who you meant.`);
        } else if (chebyshev(a.pos, target.pos) > TALK_TRIGGER_RADIUS) {
          addMemory(a, now, 'family', `You wanted to start a family with ${target.label}, but they weren't close enough.`);
        } else if (affinity < FAMILY_AFFINITY_THRESHOLD) {
          addMemory(a, now, 'family', `You considered starting a family with ${target.label}, but don't feel ready for that yet.`);
        } else if (state.agentOrder.length >= MAX_POPULATION) {
          addMemory(a, now, 'family', `You wanted to start a family with ${target.label}, but the town has no room for anyone new right now.`);
        } else if (target.familyProposalTo === a.id && now - target.familyProposalTick <= FAMILY_PROPOSAL_EXPIRY_TICKS) {
          const { config, agent: child } = createChildAgent(a, target, state.world);
          state.agentConfigs.push(config);
          state.agents[child.id] = child;
          state.agentOrder.push(child.id);
          a.familyProposalTo = null;
          target.familyProposalTo = null;
          a.childIds.push(child.id);
          target.childIds.push(child.id);
          addMemory(a, now, 'family', `You and ${target.label} had a child together: ${child.label}.`);
          addMemory(target, now, 'family', `You and ${a.label} had a child together: ${child.label}.`);
          pushLogEntry(state, {
            tick: now,
            text: `${a.label} and ${target.label} had a child: ${child.label}`,
            kind: 'event',
          });
        } else {
          a.familyProposalTo = target.id;
          a.familyProposalTick = now;
          addMemory(a, now, 'family', `You asked ${target.label} to start a family together.`);
          addMemory(target, now, 'family', `${a.label} wants to start a family with you.`);
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

function applyRelationshipUpdate(
  state: SimState,
  agent: Agent,
  others: Agent[],
  resp: ConversationTurnResponse,
  tick: number,
): void {
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

  state.affinityHistory.push({
    tick,
    agentId: agent.id,
    agentLabel: agent.label,
    otherId: target.id,
    otherLabel: target.label,
    affinity,
  });
  if (state.affinityHistory.length > MAX_AFFINITY_HISTORY) {
    state.affinityHistory.splice(0, state.affinityHistory.length - MAX_AFFINITY_HISTORY);
  }
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
          if (sp.model) statsFor(state, sp.model).messagesSpoken += 1;
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
        if (sp) applyRelationshipUpdate(state, sp, others, resp, now);
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
