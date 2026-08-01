import type { Agent, Relationship, RelationshipStage } from './types';

const ROMANCE_LADDER: RelationshipStage[] = [
  'romantic_interest',
  'partner',
  'married',
  'family',
];

export const NOTABLE_STAGES = new Set<RelationshipStage>([
  'friend',
  'rival',
  'romantic_interest',
  'partner',
  'married',
  'family',
]);

function clampAffinity(v: number): number {
  return Math.max(-100, Math.min(100, v));
}

function defaultRelationship(otherId: string): Relationship {
  return {
    otherId,
    affinity: 0,
    stage: 'stranger',
    romantic: false,
    interactionCount: 0,
    lastInteractionTick: 0,
    history: [],
  };
}

/**
 * Mutates `agent` to store a relationship if one doesn't exist yet. Only
 * safe to call on a live Immer draft (e.g. inside `store.mutate`) — never on
 * a plain snapshot from `getState()`, which is frozen.
 */
export function getOrCreateRelationship(agent: Agent, otherId: string): Relationship {
  let rel = agent.relationships[otherId];
  if (!rel) {
    rel = defaultRelationship(otherId);
    agent.relationships[otherId] = rel;
  }
  return rel;
}

/** Read-only lookup, safe to use on frozen state snapshots (e.g. for prompt-building). */
export function readRelationship(agent: Agent, otherId: string): Relationship {
  return agent.relationships[otherId] ?? defaultRelationship(otherId);
}

export interface InteractionResult {
  sentiment: number; // -10..10, how the exchange went
  romanticSignalA?: boolean; // A expressed romantic interest in B
  romanticSignalB?: boolean; // B expressed romantic interest in A
}

export interface RelationshipChange {
  agentId: string;
  otherId: string;
  fromStage: RelationshipStage;
  toStage: RelationshipStage;
}

function nextRomanceStage(current: RelationshipStage, affinity: number, interactions: number): RelationshipStage {
  const idx = ROMANCE_LADDER.indexOf(current);
  const startIdx = idx === -1 ? -1 : idx;
  const thresholds: { affinity: number; interactions: number }[] = [
    { affinity: 20, interactions: 1 }, // -> romantic_interest
    { affinity: 40, interactions: 4 }, // -> partner
    { affinity: 60, interactions: 8 }, // -> married
    { affinity: 75, interactions: 14 }, // -> family
  ];
  const nextIdx = startIdx + 1;
  if (nextIdx >= ROMANCE_LADDER.length) return current;
  const req = thresholds[nextIdx];
  if (affinity >= req.affinity && interactions >= req.interactions) {
    return ROMANCE_LADDER[nextIdx];
  }
  return current;
}

function computeStage(rel: Relationship, otherRel: Relationship): RelationshipStage {
  const onRomanceLadder = ROMANCE_LADDER.includes(rel.stage);
  if (onRomanceLadder) {
    // Already committed to the romance path; can keep climbing or stay put,
    // but a severe affinity crash can still break things off back to rival.
    if (rel.affinity <= -30) return 'rival';
    return nextRomanceStage(rel.stage, rel.affinity, rel.interactionCount);
  }

  if (rel.affinity <= -35) return 'rival';

  const mutualRomance = rel.romantic && otherRel.romantic;
  if (mutualRomance && rel.affinity >= 20 && rel.interactionCount >= 1) {
    return 'romantic_interest';
  }

  if (rel.affinity >= 15) return 'friend';
  if (rel.interactionCount >= 1) return 'acquaintance';
  return 'stranger';
}

/**
 * Applies the outcome of one interaction to both agents' relationship state.
 * Returns the list of notable stage transitions (for the event log), and
 * whether the pair just reached 'married' status still without a child, i.e.
 * 'family' stage newly reached this call (caller should spawn a child agent).
 */
export function applyInteraction(
  agentA: Agent,
  agentB: Agent,
  tickNow: number,
  result: InteractionResult,
): { changes: RelationshipChange[]; newlyFamily: boolean } {
  const relAB = getOrCreateRelationship(agentA, agentB.id);
  const relBA = getOrCreateRelationship(agentB, agentA.id);

  relAB.affinity = clampAffinity(relAB.affinity + result.sentiment);
  relBA.affinity = clampAffinity(relBA.affinity + result.sentiment);
  relAB.interactionCount += 1;
  relBA.interactionCount += 1;
  relAB.lastInteractionTick = tickNow;
  relBA.lastInteractionTick = tickNow;
  if (result.romanticSignalA) relAB.romantic = true;
  if (result.romanticSignalB) relBA.romantic = true;

  const changes: RelationshipChange[] = [];
  let newlyFamily = false;

  const fromAB = relAB.stage;
  const fromBA = relBA.stage;
  const toAB = computeStage(relAB, relBA);
  const toBA = computeStage(relBA, relAB);

  // Keep the romance ladder in lockstep for both sides (it's a shared bond).
  let finalAB = toAB;
  let finalBA = toBA;
  if (ROMANCE_LADDER.includes(toAB) || ROMANCE_LADDER.includes(toBA)) {
    const idxA = ROMANCE_LADDER.indexOf(toAB);
    const idxB = ROMANCE_LADDER.indexOf(toBA);
    const shared = ROMANCE_LADDER[Math.min(idxA === -1 ? 0 : idxA, idxB === -1 ? 0 : idxB)];
    finalAB = shared;
    finalBA = shared;
  }

  relAB.stage = finalAB;
  relBA.stage = finalBA;

  if (finalAB !== fromAB) {
    changes.push({ agentId: agentA.id, otherId: agentB.id, fromStage: fromAB, toStage: finalAB });
    if (finalAB === 'family') newlyFamily = true;
  }
  if (finalBA !== fromBA) {
    changes.push({ agentId: agentB.id, otherId: agentA.id, fromStage: fromBA, toStage: finalBA });
  }

  return { changes, newlyFamily };
}

export function stageLabel(stage: RelationshipStage): string {
  switch (stage) {
    case 'stranger':
      return 'Stranger';
    case 'acquaintance':
      return 'Acquaintance';
    case 'friend':
      return 'Friend';
    case 'rival':
      return 'Rival';
    case 'romantic_interest':
      return 'Romantic interest';
    case 'partner':
      return 'Dating';
    case 'married':
      return 'Married';
    case 'family':
      return 'Married with a child';
  }
}
