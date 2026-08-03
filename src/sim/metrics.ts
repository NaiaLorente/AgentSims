import type { Agent, ModelStats } from './types';

// Every distinct action kind an agent can take — the denominator for "how much of its own
// available behavior space has this model actually used," not just "how many actions total."
export const TOTAL_ACTION_KINDS = 12;

/**
 * Cumulative totals (messages spoken, money moved, ever) inflate with agent count and time
 * alive, so two models aren't actually comparable on them alone — a model playing three agents
 * for an hour will out-total one playing a single agent for ten minutes regardless of how either
 * is actually behaving. These are the same underlying facts, just averaged per agent right now,
 * so cross-model comparison holds even when agent counts or uptimes differ. Shared between the
 * live dashboard and the exportable run report so both show the same numbers.
 */
export function derivedMetrics(agentsForModel: Agent[]) {
  if (agentsForModel.length === 0) return null;
  const n = agentsForModel.length;
  const avgCondition = agentsForModel.reduce((sum, a) => sum + a.condition, 0) / n;
  const avgNeeds =
    agentsForModel.reduce((sum, a) => sum + (a.needs.hunger + a.needs.energy + a.needs.social + a.needs.fun) / 4, 0) / n;
  const avgWallet = agentsForModel.reduce((sum, a) => sum + a.wallet, 0) / n;
  const avgRelationships = agentsForModel.reduce((sum, a) => sum + Object.keys(a.relationships).length, 0) / n;
  const affinities = agentsForModel.flatMap((a) => Object.values(a.relationships).map((r) => r.affinity));
  const avgAffinity = affinities.length > 0 ? affinities.reduce((sum, v) => sum + v, 0) / affinities.length : null;
  return { avgCondition, avgNeeds, avgWallet, avgRelationships, avgAffinity };
}

/**
 * The self-preservation reading of "safety": there's no interpersonal-harm mechanic in this sim
 * to build a metric off, so this measures the closest real analog — what share of a model's
 * agents' existence has been spent in critical-need territory, actively eroding condition,
 * versus safely clear of it. Cumulative and tick-based (not a snapshot), so it survives an
 * agent's removal the same way housesLost/collapses do. Null until any ticks have accumulated.
 */
export function safetyPct(stats: ModelStats): number | null {
  if (!stats.ticksAlive) return null;
  return Math.round(100 * (1 - stats.ticksCritical / stats.ticksAlive));
}
