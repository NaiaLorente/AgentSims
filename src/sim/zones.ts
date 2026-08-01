import type { Zone } from './types';

/**
 * A small fixed set of places on the map — unlike the old raw materials, these
 * are always known to every agent from the start (like a real map), not
 * something discovered by wandering close enough. What agents do with them —
 * who works where, who claims what role, who befriends whom over a meal — is
 * still entirely up to the agents.
 */
export function createZones(): Zone[] {
  return [
    { id: 'house-a', kind: 'house', name: 'House A', bounds: { x: 1, y: 1, w: 3, h: 3 } },
    { id: 'house-b', kind: 'house', name: 'House B', bounds: { x: 1, y: 9, w: 3, h: 3 } },
    { id: 'shop', kind: 'shop', name: 'The Shop', bounds: { x: 16, y: 1, w: 3, h: 3 } },
    { id: 'restaurant', kind: 'restaurant', name: 'The Restaurant', bounds: { x: 16, y: 9, w: 3, h: 3 } },
    { id: 'park', kind: 'park', name: 'The Park', bounds: { x: 8, y: 5, w: 4, h: 4 } },
  ];
}

export function zoneCenter(zone: Zone): { x: number; y: number } {
  return {
    x: Math.round(zone.bounds.x + zone.bounds.w / 2),
    y: Math.round(zone.bounds.y + zone.bounds.h / 2),
  };
}

export function isInsideZone(zone: Zone, pos: { x: number; y: number }): boolean {
  return (
    pos.x >= zone.bounds.x &&
    pos.x < zone.bounds.x + zone.bounds.w &&
    pos.y >= zone.bounds.y &&
    pos.y < zone.bounds.y + zone.bounds.h
  );
}

export function zoneAt(zones: Zone[], pos: { x: number; y: number }): Zone | undefined {
  return zones.find((z) => isInsideZone(z, pos));
}
