import { useSimStore, makeLogId, type SimState } from '../state/simStore';
import type { Agent, RelationshipStage, Vec2, WalkGoal } from './types';
import { findPath } from './pathfinding';
import { getLocation, locationAt } from './world';
import { RESTORE_PER_TICK, clampNeed, decayNeeds } from './needs';
import { addMemory } from './memory';
import {
  buildConversationPrompt,
  buildPlannerPrompt,
  CONVERSATION_SCHEMA,
  type ConversationResponse,
  fallbackConversationResponse,
  fallbackPlannerResponse,
  parseIntent,
  PLANNER_SCHEMA,
  type PlannerResponse,
} from '../llm/prompts';
import { chatJSON } from '../llm/client';
import { applyInteraction, NOTABLE_STAGES } from './relationships';
import { spawnChild } from './agents';

const NEARBY_RADIUS = 4;
const TALK_TRIGGER_RADIUS = 1;
const IDLE_COOLDOWN_TICKS = 3;

function chebyshev(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
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
      stepAgent(state, agent, tick, pendingConversations);
    }
  });

  const afterMovement = useSimStore.getState();
  const toPlan = afterMovement.agentOrder.filter((id) => {
    const a = afterMovement.agents[id];
    return a && a.activity.kind === 'idle' && tick >= a.activity.cooldownUntilTick;
  });

  if (toPlan.length > 0) {
    const toThink: string[] = [];
    useSimStore.getState().mutate((state) => {
      for (const id of toPlan) {
        const a = state.agents[id];
        if (!a) continue;
        // Safety net: don't trust the LLM (especially small local models) to
        // always prioritize survival needs — force it once something is
        // critical, rather than letting an agent starve/exhaust forever
        // while it keeps choosing to socialize.
        const forced = criticalNeedGoal(a.needs);
        if (forced) {
          beginWalk(state, a, forced);
        } else {
          a.activity = { kind: 'thinking' };
          toThink.push(id);
        }
      }
    });
    for (const id of toThink) void requestPlan(id, tick);
  }

  for (const { aId, bId } of pendingConversations) {
    void runConversation(aId, bId, tick);
  }
}

function stepAgent(
  state: SimState,
  agent: Agent,
  tick: number,
  pending: { aId: string; bId: string }[],
): void {
  agent.needs = decayNeeds(agent.needs);
  if (agent.speech && agent.speech.expiresAtTick <= tick) agent.speech = null;

  switch (agent.activity.kind) {
    case 'walking': {
      if (agent.path.length > 0) {
        agent.pos = agent.path.shift()!;
      }
      if (agent.path.length === 0) {
        agent.activity = resolveArrival(state, agent, agent.activity.then, tick, pending);
      }
      break;
    }
    case 'sleeping': {
      agent.needs.energy = clampNeed(agent.needs.energy + RESTORE_PER_TICK.sleep.energy);
      if (tick >= agent.activity.untilTick || agent.needs.energy >= 95) {
        agent.activity = { kind: 'idle', cooldownUntilTick: tick };
      }
      break;
    }
    case 'eating': {
      agent.needs.hunger = clampNeed(agent.needs.hunger + RESTORE_PER_TICK.eat.hunger);
      if (tick >= agent.activity.untilTick || agent.needs.hunger >= 95) {
        agent.activity = { kind: 'idle', cooldownUntilTick: tick };
      }
      break;
    }
    case 'relaxing': {
      agent.needs.fun = clampNeed(agent.needs.fun + RESTORE_PER_TICK.relax.fun);
      agent.needs.social = clampNeed(agent.needs.social + RESTORE_PER_TICK.relax.social);
      if (tick >= agent.activity.untilTick || agent.needs.fun >= 95) {
        agent.activity = { kind: 'idle', cooldownUntilTick: tick };
      }
      break;
    }
    case 'talking':
    case 'thinking':
    case 'idle':
      break;
  }
}

function resolveArrival(
  state: SimState,
  agent: Agent,
  goal: WalkGoal,
  tick: number,
  pending: { aId: string; bId: string }[],
): Agent['activity'] {
  switch (goal.kind) {
    case 'sleep':
      addMemory(agent, tick, 'observation', 'Went home to sleep.');
      return { kind: 'sleeping', untilTick: tick + 8 };
    case 'eat':
      addMemory(agent, tick, 'observation', 'Grabbed something to eat at the cafe.');
      return { kind: 'eating', untilTick: tick + 3 };
    case 'relax':
      addMemory(agent, tick, 'observation', 'Relaxed at the park.');
      return { kind: 'relaxing', untilTick: tick + 3 };
    case 'wander': {
      const loc = locationAt(state.world, agent.pos);
      if (loc) addMemory(agent, tick, 'observation', `Hung out at ${loc.name}.`);
      agent.needs.social = clampNeed(agent.needs.social + 8);
      return { kind: 'idle', cooldownUntilTick: tick + IDLE_COOLDOWN_TICKS };
    }
    case 'talk': {
      const target = state.agents[goal.targetId];
      if (!target || target.activity.kind === 'talking' || chebyshev(agent.pos, target.pos) > TALK_TRIGGER_RADIUS) {
        return { kind: 'idle', cooldownUntilTick: tick + IDLE_COOLDOWN_TICKS };
      }
      target.activity = { kind: 'talking', withAgentId: agent.id, untilTick: tick + 2 };
      pending.push({ aId: agent.id, bId: target.id });
      return { kind: 'talking', withAgentId: target.id, untilTick: tick + 2 };
    }
  }
}

const CRITICAL_NEED = 12;

function criticalNeedGoal(needs: Agent['needs']): 'sleep' | 'eat' | 'relax' | null {
  if (needs.energy < CRITICAL_NEED) return 'sleep';
  if (needs.hunger < CRITICAL_NEED) return 'eat';
  if (needs.fun < CRITICAL_NEED) return 'relax';
  return null;
}

function beginWalk(state: SimState, agent: Agent, goal: 'sleep' | 'eat' | 'relax' | 'wander'): void {
  const locationId = goal === 'sleep' ? agent.homeLocationId : goal === 'eat' ? 'cafe' : 'park';
  const loc = getLocation(state.world, locationId);
  agent.path = findPath(state.world, agent.pos, loc.anchor);
  agent.activity = { kind: 'walking', then: { kind: goal } };
}

async function requestPlan(agentId: string, tickAtRequest: number): Promise<void> {
  const state0 = useSimStore.getState();
  const agent = state0.agents[agentId];
  if (!agent) return;

  const nearby = state0.agentOrder
    .map((id) => state0.agents[id])
    .filter((o): o is Agent => !!o && o.id !== agentId && chebyshev(o.pos, agent.pos) <= NEARBY_RADIUS);

  const { system, user } = buildPlannerPrompt(agent, nearby, tickAtRequest);
  const resp = await chatJSON<PlannerResponse>(
    state0.settings,
    { system, user, schema: PLANNER_SCHEMA },
    fallbackPlannerResponse(),
  );
  const validTargets = new Set(nearby.map((o) => o.id));
  const intent = parseIntent(resp, validTargets);

  useSimStore.getState().mutate((state) => {
    const a = state.agents[agentId];
    if (!a || a.activity.kind !== 'thinking') return; // stale: reset or re-planned meanwhile
    if (resp.thought) addMemory(a, tickAtRequest, 'thought', resp.thought);

    switch (intent.kind) {
      case 'go_sleep':
        beginWalk(state, a, 'sleep');
        break;
      case 'go_eat':
        beginWalk(state, a, 'eat');
        break;
      case 'go_relax':
        beginWalk(state, a, 'relax');
        break;
      case 'go_socialize':
        beginWalk(state, a, 'wander');
        break;
      case 'talk_to': {
        const target = state.agents[intent.targetId];
        if (!target) {
          a.activity = { kind: 'idle', cooldownUntilTick: tickAtRequest + IDLE_COOLDOWN_TICKS };
          break;
        }
        a.path = findPath(state.world, a.pos, target.pos);
        a.activity = { kind: 'walking', then: { kind: 'talk', targetId: target.id } };
        break;
      }
      case 'idle':
        a.activity = { kind: 'idle', cooldownUntilTick: tickAtRequest + IDLE_COOLDOWN_TICKS };
        break;
    }
  });
}

function describeStageChange(agentName: string, otherName: string, stage: RelationshipStage): string {
  switch (stage) {
    case 'friend':
      return `${agentName} and ${otherName} became friends.`;
    case 'rival':
      return `${agentName} and ${otherName} became rivals.`;
    case 'romantic_interest':
      return `${agentName} caught feelings for ${otherName}.`;
    case 'partner':
      return `${agentName} and ${otherName} started dating!`;
    case 'married':
      return `${agentName} and ${otherName} got married!`;
    case 'family':
      return `${agentName} and ${otherName} are starting a family.`;
    default:
      return `${agentName}'s relationship with ${otherName} shifted.`;
  }
}

async function runConversation(aId: string, bId: string, tick: number): Promise<void> {
  const state0 = useSimStore.getState();
  const a = state0.agents[aId];
  const b = state0.agents[bId];
  if (!a || !b) return;

  const { system, user } = buildConversationPrompt(a, b, tick);
  const resp = await chatJSON<ConversationResponse>(
    state0.settings,
    { system, user, schema: CONVERSATION_SCHEMA },
    fallbackConversationResponse(a, b),
  );

  useSimStore.getState().mutate((state) => {
    const agentA = state.agents[aId];
    const agentB = state.agents[bId];
    if (!agentA || !agentB) return;
    const nowTick = state.clock.tick;

    let lastA = '';
    let lastB = '';
    for (const turn of resp.turns ?? []) {
      const text = (turn.text ?? '').slice(0, 140);
      if (!text) continue;
      if (turn.speaker === 'A') lastA = text;
      else lastB = text;
    }
    if (lastA) agentA.speech = { text: lastA, expiresAtTick: nowTick + 3 };
    if (lastB) agentB.speech = { text: lastB, expiresAtTick: nowTick + 3 };

    const summary = resp.summary || `${agentA.name} and ${agentB.name} talked.`;
    addMemory(agentA, nowTick, 'conversation', summary);
    addMemory(agentB, nowTick, 'conversation', summary);
    state.log.push({ id: makeLogId(), tick: nowTick, text: summary, kind: 'conversation' });

    agentA.needs.social = clampNeed(agentA.needs.social + 15);
    agentB.needs.social = clampNeed(agentB.needs.social + 15);

    const { changes, newlyFamily } = applyInteraction(agentA, agentB, nowTick, {
      sentiment: typeof resp.sentiment === 'number' ? resp.sentiment : 0,
      romanticSignalA: !!resp.romanticSignalA,
      romanticSignalB: !!resp.romanticSignalB,
    });

    const seen = new Set<string>();
    for (const change of changes) {
      if (!NOTABLE_STAGES.has(change.toStage)) continue;
      const pairKey = [change.agentId, change.otherId].sort().join('_') + '_' + change.toStage;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      const who = state.agents[change.agentId];
      const other = state.agents[change.otherId];
      if (!who || !other) continue;
      const text = describeStageChange(who.name, other.name, change.toStage);
      state.log.push({ id: makeLogId(), tick: nowTick, text, kind: 'milestone' });
    }

    agentA.activity = { kind: 'idle', cooldownUntilTick: nowTick + IDLE_COOLDOWN_TICKS };
    agentB.activity = { kind: 'idle', cooldownUntilTick: nowTick + IDLE_COOLDOWN_TICKS };

    if (newlyFamily) {
      const child = spawnChild(state.world, agentA, agentB);
      state.agents[child.id] = child;
      state.agentOrder.push(child.id);
      state.log.push({
        id: makeLogId(),
        tick: nowTick,
        text: `${agentA.name} and ${agentB.name} welcomed a child: ${child.name}!`,
        kind: 'milestone',
      });
    }
  });
}
