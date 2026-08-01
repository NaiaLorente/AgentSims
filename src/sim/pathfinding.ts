import type { Vec2, World } from './types';
import { isWalkable } from './world';

const DIRS: Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function key(p: Vec2): string {
  return `${p.x},${p.y}`;
}

/**
 * BFS shortest path on the tile grid. Returns the path excluding `from`,
 * including `to`. The target tile itself is always considered walkable
 * (it's typically a location anchor) even if it isn't 'ground'/'path'.
 */
export function findPath(world: World, from: Vec2, to: Vec2): Vec2[] {
  if (from.x === to.x && from.y === to.y) return [];

  const walkable = (p: Vec2) => (p.x === to.x && p.y === to.y ? true : isWalkable(world, p));

  const cameFrom = new Map<string, Vec2>();
  const visited = new Set<string>([key(from)]);
  const queue: Vec2[] = [from];
  let head = 0;
  let found = false;

  while (head < queue.length) {
    const cur = queue[head++];
    if (cur.x === to.x && cur.y === to.y) {
      found = true;
      break;
    }
    for (const d of DIRS) {
      const next = { x: cur.x + d.x, y: cur.y + d.y };
      const k = key(next);
      if (visited.has(k)) continue;
      if (!walkable(next)) continue;
      visited.add(k);
      cameFrom.set(k, cur);
      queue.push(next);
    }
  }

  if (!found) return [];

  const path: Vec2[] = [];
  let cur = to;
  while (!(cur.x === from.x && cur.y === from.y)) {
    path.push(cur);
    const prev = cameFrom.get(key(cur));
    if (!prev) break;
    cur = prev;
  }
  return path.reverse();
}
