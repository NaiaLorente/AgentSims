export interface Vec2 {
  x: number;
  y: number;
}

export type ActivityKind = 'sleep' | 'eat' | 'relax' | 'social';

export interface Location {
  id: string;
  name: string;
  emoji: string;
  /** Tiles occupied by the building/zone footprint (rendered, non-walkable except anchor). */
  footprint: Vec2[];
  /** The single walkable tile agents path to and stand on while performing activities here. */
  anchor: Vec2;
  activities: ActivityKind[];
  color: string;
}

export type TileKind = 'ground' | 'path' | 'blocked' | 'water';

export interface World {
  width: number;
  height: number;
  tiles: TileKind[][]; // [y][x]
  locations: Location[];
}

export type RelationshipStage =
  | 'stranger'
  | 'acquaintance'
  | 'friend'
  | 'rival'
  | 'romantic_interest'
  | 'partner'
  | 'married'
  | 'family';

export interface Relationship {
  otherId: string;
  affinity: number; // -100..100
  stage: RelationshipStage;
  romantic: boolean; // this agent wants/has a romantic connection with the other
  interactionCount: number;
  lastInteractionTick: number;
  history: string[]; // short milestone descriptions, most recent last
}

export type MemoryKind = 'observation' | 'conversation' | 'milestone' | 'thought';

export interface MemoryEvent {
  id: string;
  tick: number;
  kind: MemoryKind;
  text: string;
}

export type AgentIntent =
  | { kind: 'go_sleep' }
  | { kind: 'go_eat' }
  | { kind: 'go_relax' }
  | { kind: 'go_socialize' }
  | { kind: 'talk_to'; targetId: string }
  | { kind: 'idle'; reason?: string };

/** What an agent should do once a `walking` path finishes. */
export type WalkGoal =
  | { kind: 'sleep' }
  | { kind: 'eat' }
  | { kind: 'relax' }
  | { kind: 'wander' }
  | { kind: 'talk'; targetId: string };

export type ActivityState =
  | { kind: 'idle'; cooldownUntilTick: number }
  | { kind: 'thinking' } // waiting on a planner LLM call
  | { kind: 'walking'; then: WalkGoal }
  | { kind: 'sleeping'; untilTick: number }
  | { kind: 'eating'; untilTick: number }
  | { kind: 'relaxing'; untilTick: number }
  | { kind: 'talking'; withAgentId: string; untilTick: number };

export interface Needs {
  energy: number;
  hunger: number;
  social: number;
  fun: number;
}

export interface Persona {
  bio: string;
  traits: string[];
}

export interface SpeechBubble {
  text: string;
  expiresAtTick: number;
}

export interface Agent {
  id: string;
  name: string;
  emoji: string;
  color: string;
  persona: Persona;
  homeLocationId: string;
  pos: Vec2; // current tile position (integer)
  path: Vec2[]; // remaining tiles to walk, next-first
  needs: Needs;
  activity: ActivityState;
  relationships: Record<string, Relationship>;
  memory: MemoryEvent[];
  speech: SpeechBubble | null;
  isChild: boolean;
  generation: number;
  parentIds: string[];
}

export interface LogEntry {
  id: string;
  tick: number;
  text: string;
  kind: 'milestone' | 'conversation' | 'system';
}

export interface SimClock {
  tick: number;
  running: boolean;
  ticksPerSecond: number; // playback speed
}
