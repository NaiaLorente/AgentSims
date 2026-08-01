import { useSimStore, makeLogId, type SimState } from '../state/simStore';
import type { Agent, Direction, Vec2, WalkGoal, WorldObject } from './types';
import { findPath } from './pathfinding';
import { randomTile } from './world';
import { addMemory } from './memory';
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
const MAX_WORLD_OBJECTS = 200;

let objectCounter = 0;
function makeWorldObjectId(): string {
  objectCounter += 1;
  return `obj_${Date.now().toString(36)}_${objectCounter}`;
}

function chebyshev(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function agentSettings(globalSettings: SimState['settings'], agent: Agent): OllamaSettings {
  return { baseUrl: globalSettings.baseUrl, temperature: globalSettings.temperature, model: agent.model };
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
  const nearbyObjects = state0.worldObjects.filter((o) => chebyshev(o.pos, agent.pos) <= NEARBY_RADIUS);

  const { system, user } = buildPlannerPrompt(agent, nearby, nearbyObjects);
  const resp = await chatJSON<PlannerResponse>(
    agentSettings(state0.settings, agent),
    { system, user, schema: PLANNER_SCHEMA },
    fallbackPlannerResponse(),
  );
  const validTargets = new Set(nearby.map((o) => o.id));
  const validObjects = new Set(nearbyObjects.map((o) => o.id));
  const intent = parseIntent(resp, validTargets, validObjects);

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
          state.log.push({
            id: makeLogId(),
            tick: now,
            text: intent.message,
            kind: 'conversation',
            speakerLabel: a.label,
          });
          for (const otherId of state.agentOrder) {
            if (otherId === agentId) continue;
            const other = state.agents[otherId];
            if (other && chebyshev(other.pos, a.pos) <= NEARBY_RADIUS) {
              addMemory(other, now, 'heard', `${a.label} said: "${intent.message}"`);
            }
          }
        }
        a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
        break;
      }
      case 'create': {
        if (intent.content) {
          const existing = intent.targetId ? state.worldObjects.find((o) => o.id === intent.targetId) : undefined;
          if (existing) {
            existing.additions.push({ agentLabel: a.label, content: intent.content, tick: now });
            addMemory(a, now, 'made', `You added to "${existing.content}": "${intent.content}"`);
            state.log.push({
              id: makeLogId(),
              tick: now,
              text: `${a.label} added to "${existing.content}": "${intent.content}"`,
              kind: 'creation',
            });
          } else {
            const obj: WorldObject = {
              id: makeWorldObjectId(),
              natural: false,
              creatorId: a.id,
              creatorLabel: a.label,
              pos: { ...a.pos },
              content: intent.content,
              tick: now,
              additions: [],
            };
            state.worldObjects.push(obj);
            const agentMade = state.worldObjects.filter((o) => !o.natural);
            if (agentMade.length > MAX_WORLD_OBJECTS) {
              const overflow = agentMade.length - MAX_WORLD_OBJECTS;
              const toRemove = new Set(agentMade.slice(0, overflow).map((o) => o.id));
              state.worldObjects = state.worldObjects.filter((o) => !toRemove.has(o.id));
            }
            addMemory(a, now, 'made', `You left: "${intent.content}"`);
            state.log.push({
              id: makeLogId(),
              tick: now,
              text: `${a.label} made: "${intent.content}"`,
              kind: 'creation',
            });
          }
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

async function runConversation(aId: string, bId: string): Promise<void> {
  let speakerId = aId;
  let listenerId = bId;
  const transcript: TranscriptLine[] = [];

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
    if (message) {
      transcript.push({ speakerLabel: speaker.label, text: message });
      useSimStore.getState().mutate((state) => {
        const sp = state.agents[speakerId];
        const li = state.agents[listenerId];
        const now = state.clock.tick;
        if (sp) {
          sp.speech = { text: message.slice(0, 200), expiresAtTick: now + 4 };
          addMemory(sp, now, 'said', `You said to ${listener.label}: "${message}"`);
        }
        if (li) addMemory(li, now, 'heard', `${speaker.label} said to you: "${message}"`);
        state.log.push({
          id: makeLogId(),
          tick: now,
          text: message,
          kind: 'conversation',
          speakerLabel: speaker.label,
          listenerLabel: listener.label,
        });
      });
    }

    if (resp.end) break;
    [speakerId, listenerId] = [listenerId, speakerId];
  }

  useSimStore.getState().mutate((state) => {
    const now = state.clock.tick;
    const a = state.agents[aId];
    const b = state.agents[bId];
    if (a && a.activity.kind === 'talking') a.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
    if (b && b.activity.kind === 'talking') b.activity = { kind: 'idle', cooldownUntilTick: now + IDLE_COOLDOWN_TICKS };
  });
}
