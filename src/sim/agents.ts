import type { Agent } from './types';
import { makeFullNeeds } from './needs';
import { getLocation } from './world';
import type { World } from './types';

interface SeedAgent {
  id: string;
  name: string;
  emoji: string;
  color: string;
  bio: string;
  traits: string[];
  homeLocationId: string;
}

const SEED_AGENTS: SeedAgent[] = [
  {
    id: 'alex',
    name: 'Alex',
    emoji: '🧑',
    color: '#f97316',
    bio: 'A restless painter who talks to strangers a little too easily.',
    traits: ['curious', 'flirtatious', 'impulsive'],
    homeLocationId: 'home_a',
  },
  {
    id: 'briar',
    name: 'Briar',
    emoji: '🧑‍🦱',
    color: '#22c55e',
    bio: 'A quiet gardener who prefers routines and old books to small talk.',
    traits: ['introverted', 'loyal', 'stubborn'],
    homeLocationId: 'home_a',
  },
  {
    id: 'coral',
    name: 'Coral',
    emoji: '👩',
    color: '#06b6d4',
    bio: 'A sharp-tongued barista who says exactly what she thinks.',
    traits: ['blunt', 'witty', 'competitive'],
    homeLocationId: 'home_b',
  },
  {
    id: 'dax',
    name: 'Dax',
    emoji: '🧔',
    color: '#a855f7',
    bio: 'An easygoing musician who falls for people fast and hard.',
    traits: ['romantic', 'charming', 'disorganized'],
    homeLocationId: 'home_b',
  },
  {
    id: 'ember',
    name: 'Ember',
    emoji: '👱',
    color: '#ef4444',
    bio: 'A hot-headed ex-athlete still figuring out what she wants.',
    traits: ['ambitious', 'jealous', 'passionate'],
    homeLocationId: 'home_a',
  },
];

export function createInitialAgents(world: World): Agent[] {
  const homeSlot: Record<string, number> = {};
  return SEED_AGENTS.map((seed) => {
    const home = getLocation(world, seed.homeLocationId);
    const slot = homeSlot[seed.homeLocationId] ?? 0;
    homeSlot[seed.homeLocationId] = slot + 1;
    const startPos = home.footprint[slot % home.footprint.length];
    return {
      id: seed.id,
      name: seed.name,
      emoji: seed.emoji,
      color: seed.color,
      persona: { bio: seed.bio, traits: seed.traits },
      homeLocationId: seed.homeLocationId,
      pos: { ...startPos },
      path: [],
      needs: makeFullNeeds(),
      activity: { kind: 'idle', cooldownUntilTick: 0 },
      relationships: {},
      memory: [],
      speech: null,
      isChild: false,
      generation: 0,
      parentIds: [],
    } satisfies Agent;
  });
}

let childCounter = 0;

export function spawnChild(world: World, parentA: Agent, parentB: Agent): Agent {
  childCounter += 1;
  const home = getLocation(world, parentA.homeLocationId);
  const names = ['Sky', 'Wren', 'Robin', 'River', 'Sage', 'Juniper', 'Ash', 'Lark'];
  const name = names[(childCounter - 1) % names.length] + (childCounter > names.length ? ` ${childCounter}` : '');
  const traitPool = [...parentA.persona.traits, ...parentB.persona.traits];
  const traits = Array.from(new Set(traitPool)).slice(0, 3);

  return {
    id: `child_${Date.now().toString(36)}_${childCounter}`,
    name,
    emoji: '🧒',
    color: parentA.color,
    persona: {
      bio: `Child of ${parentA.name} and ${parentB.name}, still finding their own way.`,
      traits: traits.length > 0 ? traits : ['curious'],
    },
    homeLocationId: parentA.homeLocationId,
    pos: { ...home.anchor },
    path: [],
    needs: makeFullNeeds(),
    activity: { kind: 'idle', cooldownUntilTick: 0 },
    relationships: {},
    memory: [],
    speech: null,
    isChild: true,
    generation: Math.max(parentA.generation, parentB.generation) + 1,
    parentIds: [parentA.id, parentB.id],
  } satisfies Agent;
}
