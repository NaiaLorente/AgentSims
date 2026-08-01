import type { Location, TileKind, Vec2, World } from './types';

export const WORLD_WIDTH = 22;
export const WORLD_HEIGHT = 16;

function rectTiles(x0: number, y0: number, w: number, h: number): Vec2[] {
  const tiles: Vec2[] = [];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}

export function buildWorld(): World {
  const tiles: TileKind[][] = Array.from({ length: WORLD_HEIGHT }, () =>
    Array.from({ length: WORLD_WIDTH }, () => 'ground' as TileKind),
  );

  const locations: Location[] = [
    {
      id: 'home_a',
      name: 'Willow House',
      emoji: '🏠',
      footprint: rectTiles(1, 1, 3, 3),
      anchor: { x: 2, y: 4 },
      activities: ['sleep'],
      color: '#7c6f57',
    },
    {
      id: 'home_b',
      name: 'Maple House',
      emoji: '🏡',
      footprint: rectTiles(18, 1, 3, 3),
      anchor: { x: 19, y: 4 },
      activities: ['sleep'],
      color: '#5f7a63',
    },
    {
      id: 'cafe',
      name: "Cafe Luna",
      emoji: '☕',
      footprint: rectTiles(9, 6, 4, 3),
      anchor: { x: 10, y: 9 },
      activities: ['eat', 'social'],
      color: '#8a5a3c',
    },
    {
      id: 'park',
      name: 'Sunset Park',
      emoji: '🌳',
      footprint: rectTiles(3, 11, 5, 3),
      anchor: { x: 5, y: 11 },
      activities: ['relax', 'social'],
      color: '#3f7d4f',
    },
  ];

  // Mark building footprints as blocked, except the anchor/door tile.
  for (const loc of locations) {
    for (const t of loc.footprint) {
      if (t.x === loc.anchor.x && t.y === loc.anchor.y) continue;
      if (t.y >= 0 && t.y < WORLD_HEIGHT && t.x >= 0 && t.x < WORLD_WIDTH) {
        tiles[t.y][t.x] = 'blocked';
      }
    }
  }

  // A small pond for flavor + a pathfinding obstacle.
  for (const t of rectTiles(14, 10, 3, 2)) {
    tiles[t.y][t.x] = 'water';
  }

  // A short decorative fence line near the park entrance (still blocks movement).
  for (const t of [
    { x: 8, y: 12 },
    { x: 8, y: 13 },
  ]) {
    tiles[t.y][t.x] = 'blocked';
  }

  return { width: WORLD_WIDTH, height: WORLD_HEIGHT, tiles, locations };
}

export function isWalkable(world: World, pos: Vec2): boolean {
  if (pos.x < 0 || pos.y < 0 || pos.x >= world.width || pos.y >= world.height) return false;
  const t = world.tiles[pos.y][pos.x];
  return t === 'ground' || t === 'path';
}

export function getLocation(world: World, id: string): Location {
  const loc = world.locations.find((l) => l.id === id);
  if (!loc) throw new Error(`Unknown location: ${id}`);
  return loc;
}

export function locationAt(world: World, pos: Vec2): Location | null {
  return (
    world.locations.find((l) => l.anchor.x === pos.x && l.anchor.y === pos.y) ??
    world.locations.find((l) => l.footprint.some((t) => t.x === pos.x && t.y === pos.y)) ??
    null
  );
}
