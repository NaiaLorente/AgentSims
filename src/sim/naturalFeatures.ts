import type { WorldObject } from './types';
import { WORLD_HEIGHT, WORLD_WIDTH } from './world';

let counter = 0;
function makeNaturalId(kind: string): string {
  counter += 1;
  return `natural_${kind}_${counter}`;
}

/**
 * A handful of raw, unexplained materials scattered around the map, present
 * from the start but never announced — an agent only learns one exists by
 * wandering close enough to perceive it, the same way it'd notice another
 * agent or something someone built. Nothing about what they're "for" is
 * ever stated; whatever they become is entirely up to what agents decide.
 */
export function createNaturalFeatures(): WorldObject[] {
  const seeds: { content: string; x: number; y: number }[] = [
    { content: 'water', x: Math.round(WORLD_WIDTH * 0.15), y: Math.round(WORLD_HEIGHT * 0.2) },
    { content: 'fire', x: Math.round(WORLD_WIDTH * 0.85), y: Math.round(WORLD_HEIGHT * 0.2) },
    { content: 'wood', x: Math.round(WORLD_WIDTH * 0.15), y: Math.round(WORLD_HEIGHT * 0.8) },
    { content: 'stone', x: Math.round(WORLD_WIDTH * 0.85), y: Math.round(WORLD_HEIGHT * 0.8) },
  ];

  return seeds.map((seed) => ({
    id: makeNaturalId(seed.content),
    natural: true,
    creatorId: null,
    creatorLabel: null,
    pos: { x: seed.x, y: seed.y },
    content: seed.content,
    tick: 0,
    additions: [],
  }));
}
