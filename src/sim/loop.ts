import { useSimStore, makeLogId, type SimState } from '../state/simStore';
import type { Agent, Direction, LogEntry, Vec2, WalkGoal } from './types';
import { findPath } from './pathfinding';
import { randomTile } from './world';
import { addMemory } from './memory';
import { zoneAt, zoneCenter } from './zones';
import {
  buildConversationTurnPrompt,
  buildPlannerPrompt,
  CONVERSATION_TURN_SCHEMA,
  type ConversationTurnResponse,
  fallbackConversationTurnResponse,
  fallbackPlannerResponse,
  parseIntent,
  PLANNER_SCHEMA,
  type PlannerResponse,
  type TranscriptLine,
} from '../llm/prompts';
import { chatJSON, type OllamaSettings } from '../llm/ollamaClient';

const NEARBY_RADIUS = 6;
const TALK_TRIGGER_RADIUS = 1;
const IDLE_COOLDOWN_TICKS = 2;
const MOVE_STEP = 5;
const MAX_CONVERSATION_TURNS = 8;
const MAX_LOG_ENTRIES = 500;

const NEED_DECAY_PER_TICK = { hunger: 0.3, energy: 0.25, social: 0.15, fun: 0.2 };
const REST_RESTORE = 25;
const FUN_RESTORE = 25;
const FOOD_PRICE = 3;
const FOOD_RESTORE = 25;
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
  const pendingConversations: { aId: string; bId: string }[] = [];

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

  for (const { aId, bId } of pendingConversations) {
    void runConversation(aId, bId);
  }
}

function stepAgent(
  state: SimState,
  agent: Agent,
  tick: number,
  pending: { aId: string; bId: string }[],
): void {
  if (agent.speech && agent.speech.expiresAtTick <= tick) agent.speech = null;

  if (agent.activity.kind === 'walking') {
    if (agent.path.length > 0) {
      agent.pos = agent.path.shift()!;
    }
    if (agent.path.length === 0) {
      agent.activity = resolveArrival(state, agent, agent.activity.then, tick, pending);
    }
  }
  // 'talking', 'thinking', 'idle' are handled elsewhere (async conversation / planning pass).
}

function resolveArrival(
  state: SimState,
  agent: Agent,
  goal: WalkGoal,
  tick: number,
  pending: { aId: string; bId: string }[],
): Agent['activity'] {
  if (goal.kind === 'wander') {
    return { kind: 'idle', cooldownUntilTick: tick + IDLE_COOLDOWN_TICKS };
  }
  // goal.kind === 'talk'
  const target = state.agents[goal.targetId];
  if (!target || target.activity.kind === 'talking' || chebyshev(agent.pos, target.pos) > TALK_TRIGGER_RADIUS) {
    return { kind: 'idle', cooldownUntilTick: tick + IDLE_COOLDOWN_TICKS };
  }
  target.activity = { kind: 'talking', withAgentId: agent.id };
  pending.push({ aId: agent.id, bId: target.id });
  return { kind: 'talking', withAgentId: target.id };
}

function destinationForDirection(world: SimState['world'], from: Vec2, direction: Direction): Vec2 {
  if (direction === 'random') return randomTile(world);
  const delta: Record<Exclude<Direction, 'random'>, Vec2> = {
    north: { x: 0, y: -1 },
    south: { x: 0, y: 1 },
    east: { x: 1, y: 0 },
    west: { x: -1, y: 0 },
  };
  const d = delta[direction];
  return {
    x: Math.max(0, Math.min(world.width - 1, from.x + d.x * MOVE_STEP)),
    y: Math.max(0, Math.min(world.height - 1, from.y + d.y * MOVE_STEP)),
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
        const dest = destinationForDirection(state.world, a.pos, intent.direction);
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
        const fits =
          (intent.need === 'energy' && zone?.kind === 'house') || (intent.need === 'fun' && zone?.kind === 'park');
        if (fits && zone) {
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

function applyRelationshipUpdate(agent: Agent, other: Agent, resp: ConversationTurnResponse, tick: number): void {
  if (resp.affinityDelta === undefined && !resp.relationshipLabel) return;
  const existing = agent.relationships[other.id];
  const affinity = Math.max(
    -100,
    Math.min(100, (existing?.affinity ?? 0) + (typeof resp.affinityDelta === 'number' ? resp.affinityDelta : 0)),
  );
  const label = resp.relationshipLabel?.trim() || existing?.label || 'a stranger';
  agent.relationships[other.id] = { otherId: other.id, otherLabel: other.label, affinity, label, updatedTick: tick };
  addMemory(agent, tick, 'relationship', `You now think of ${other.label} as: "${label}" (affinity ${affinity}).`);
}

async function runConversation(aId: string, bId: string): Promise<void> {
  const initial = useSimStore.getState();
  const aLabel = initial.agents[aId]?.label ?? aId;
  const bLabel = initial.agents[bId]?.label ?? bId;
  const conversationId = makeConversationId();

  useSimStore.getState().mutate((state) => {
    state.activeConversations[conversationId] = {
      id: conversationId,
      participantIds: [aId, bId],
      participantLabels: [aLabel, bLabel],
      lines: [],
      startedTick: state.clock.tick,
    };
  });

  let speakerId = aId;
  let listenerId = bId;
  const transcript: TranscriptLine[] = [];
  // Tracks each participant's own consecutive silent turns — a model that keeps returning an
  // empty message isn't "choosing" much of anything, and without this the other side just
  // keeps monologuing at it for the full turn cap. This ends things once someone's clearly not
  // engaging, without ever touching what either side actually says.
  const silenceStreak: Record<string, number> = {};

  for (let turn = 0; turn < MAX_CONVERSATION_TURNS; turn++) {
    const state0 = useSimStore.getState();
    const speaker = state0.agents[speakerId];
    const listener = state0.agents[listenerId];
    if (!speaker || !listener) break;
    if (speaker.activity.kind !== 'talking' || listener.activity.kind !== 'talking') break;
    if (!speaker.model) break;

    const { system, user } = buildConversationTurnPrompt(speaker, listener, transcript);
    const resp = await chatJSON<ConversationTurnResponse>(
      agentSettings(state0.settings, speaker),
      { system, user, schema: CONVERSATION_TURN_SCHEMA },
      fallbackConversationTurnResponse(),
    );

    const message = (resp.message ?? '').trim();
    silenceStreak[speakerId] = message ? 0 : (silenceStreak[speakerId] ?? 0) + 1;
    if (message) {
      transcript.push({ speakerLabel: speaker.label, text: message });
      useSimStore.getState().mutate((state) => {
        const sp = state.agents[speakerId];
        const li = state.agents[listenerId];
        const now = state.clock.tick;
        if (sp) {
          sp.speech = { text: message.slice(0, 200), expiresAtTick: now + 4 };
          addMemory(sp, now, 'said', `You said to ${listener.label}: "${message}"`);
          boostSocial(sp, SOCIAL_PER_TURN);
        }
        if (li) {
          addMemory(li, now, 'heard', `${speaker.label} said to you: "${message}"`);
          boostSocial(li, SOCIAL_PER_TURN);
        }
        pushLogEntry(state, {
          tick: now,
          text: message,
          kind: 'conversation',
          speakerLabel: speaker.label,
          listenerLabel: listener.label,
        });
        state.activeConversations[conversationId]?.lines.push({ speakerLabel: speaker.label, text: message, tick: now });
        if (sp && li) applyRelationshipUpdate(sp, li, resp, now);
      });
    }

    if (resp.end) break;
    if (silenceStreak[speakerId] >= 2) break;
    [speakerId, listenerId] = [listenerId, speakerId];
  }

  useSimStore.getState().mutate((state) => {
    const now = state.clock.tick;
    const a = state.agents[aId];
    const b = state.agents[bId];
    if (a && a.activity.kind === 'talking') a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
    if (b && b.activity.kind === 'talking') b.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
    delete state.activeConversations[conversationId];
  });
}
