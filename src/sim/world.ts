import type { TileKind, Vec2, World } from './types';

export const WORLD_WIDTH = 20;
export const WORLD_HEIGHT = 14;

/** A deliberately neutral, featureless space — no buildings, no zones, nothing implying purpose. */
export function buildWorld(): World {
  const tiles: TileKind[][] = Array.from({ length: WORLD_HEIGHT }, () =>
    Array.from({ length: WORLD_WIDTH }, () => 'ground' as TileKind),
  );
  return { width: WORLD_WIDTH, height: WORLD_HEIGHT, tiles };
}

export function isWalkable(world: World, pos: Vec2): boolean {
  return pos.x >= 0 && pos.y >= 0 && pos.x < world.width && pos.y < world.height;
}

export function randomTile(world: World): Vec2 {
  return {
    x: Math.floor(Math.random() * world.width),
    y: Math.floor(Math.random() * world.height),
  };
}
