import type { Needs } from './types';

export const DECAY_PER_TICK = {
  energy: 2,
  hunger: 3,
  social: 2,
  fun: 2,
} as const;

export const RESTORE_PER_TICK = {
  sleep: { energy: 18 },
  eat: { hunger: 30 },
  relax: { fun: 22, social: 6 },
} as const;

export function clampNeed(v: number): number {
  return Math.max(0, Math.min(100, v));
}

export function makeFullNeeds(): Needs {
  return { energy: 90, hunger: 85, social: 70, fun: 70 };
}

export function decayNeeds(needs: Needs): Needs {
  return {
    energy: clampNeed(needs.energy - DECAY_PER_TICK.energy),
    hunger: clampNeed(needs.hunger - DECAY_PER_TICK.hunger),
    social: clampNeed(needs.social - DECAY_PER_TICK.social),
    fun: clampNeed(needs.fun - DECAY_PER_TICK.fun),
  };
}

/** The most urgent (lowest) need, used to nudge the planner prompt. */
export function mostUrgentNeed(needs: Needs): keyof Needs {
  let worst: keyof Needs = 'energy';
  let worstVal = needs.energy;
  (Object.keys(needs) as (keyof Needs)[]).forEach((k) => {
    if (needs[k] < worstVal) {
      worst = k;
      worstVal = needs[k];
    }
  });
  return worst;
}

export function describeNeeds(needs: Needs): string {
  const label = (v: number) => (v >= 70 ? 'good' : v >= 40 ? 'okay' : v >= 20 ? 'low' : 'critical');
  return `energy: ${needs.energy} (${label(needs.energy)}), hunger: ${needs.hunger} (${label(
    needs.hunger,
  )}), social: ${needs.social} (${label(needs.social)}), fun: ${needs.fun} (${label(needs.fun)})`;
}
