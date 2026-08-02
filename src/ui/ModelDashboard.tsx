import { useSimStore } from '../state/simStore';
import type { AffinityPoint, ModelStats } from '../sim/types';

function ActionBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-20 shrink-0 truncate text-white/50">{label.replace(/_/g, ' ')}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 shrink-0 text-right text-white/40">{count}</span>
    </div>
  );
}

function ModelCard({ stats, agentLabels }: { stats: ModelStats; agentLabels: string[] }) {
  const topActions = Object.entries(stats.actionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const maxCount = topActions.length > 0 ? topActions[0][1] : 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-black/20 p-3 text-xs">
      <div>
        <div className="font-semibold text-white/85">{stats.model}</div>
        {agentLabels.length > 0 && <div className="text-[10px] text-white/40">playing {agentLabels.join(', ')}</div>}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-white/60">
        <div>
          Messages: <span className="text-white/80">{stats.messagesSpoken}</span>
        </div>
        <div>
          Earned: <span className="text-emerald-400/80">${stats.moneyEarned}</span>
        </div>
        <div>
          Spent: <span className="text-orange-400/80">${stats.moneySpent}</span>
        </div>
        <div>
          Given: <span className="text-sky-400/80">${stats.moneyGiven}</span>
        </div>
      </div>

      {topActions.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-white/10 pt-2">
          {topActions.map(([kind, count]) => (
            <ActionBar key={kind} label={kind} count={count} max={maxCount} />
          ))}
        </div>
      )}
    </div>
  );
}

function affinityColor(v: number): string {
  if (v >= 60) return '#ec4899'; // loving
  if (v >= 20) return '#22c55e'; // friendly
  if (v > -20) return '#94a3b8'; // neutral
  if (v > -60) return '#f97316'; // tense
  return '#ef4444'; // hostile
}

function Sparkline({ points }: { points: number[] }) {
  const w = 110;
  const h = 26;
  const mid = h / 2;
  const toY = (v: number) => mid - (v / 100) * (mid - 3);

  const coords = points.map((v, i) => {
    const x = points.length > 1 ? (i / (points.length - 1)) * w : w / 2;
    return `${x},${toY(v)}`;
  });

  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden>
      <line x1={0} y1={mid} x2={w} y2={mid} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
      {points.length > 1 ? (
        <polyline points={coords.join(' ')} fill="none" stroke={affinityColor(points[points.length - 1])} strokeWidth={1.5} />
      ) : (
        <circle cx={w / 2} cy={toY(points[0])} r={2.5} fill={affinityColor(points[0])} />
      )}
    </svg>
  );
}

function groupAffinityHistory(history: AffinityPoint[]): Map<string, AffinityPoint[]> {
  const groups = new Map<string, AffinityPoint[]>();
  for (const point of history) {
    const key = `${point.agentId}->${point.otherId}`;
    const group = groups.get(key);
    if (group) group.push(point);
    else groups.set(key, [point]);
  }
  return groups;
}

/**
 * Cross-model comparison — the whole point of running several agents on different models is
 * being able to actually compare them, and scrolling the transcript doesn't do that. Everything
 * here is derived from real counters and real relationship history, nothing invented for
 * display purposes.
 */
export function ModelDashboard() {
  const modelStats = useSimStore((s) => s.modelStats);
  const affinityHistory = useSimStore((s) => s.affinityHistory);
  const agents = useSimStore((s) => s.agents);
  const agentOrder = useSimStore((s) => s.agentOrder);

  const models = Object.values(modelStats);
  const affinityGroups = groupAffinityHistory(affinityHistory);

  if (models.length === 0 && affinityGroups.size === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-white/60">
        Model comparison <span className="normal-case text-white/30">— what each model has actually done</span>
      </h2>

      {models.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {models.map((stats) => (
            <ModelCard
              key={stats.model}
              stats={stats}
              agentLabels={agentOrder.map((id) => agents[id]).filter((a) => a?.model === stats.model).map((a) => a!.label)}
            />
          ))}
        </div>
      )}

      {affinityGroups.size > 0 && (
        <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-white/60">Relationship trends</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...affinityGroups.entries()].map(([key, points]) => (
              <div key={key} className="flex items-center gap-2 rounded-md bg-black/20 px-2 py-1.5 text-[11px]">
                <span className="w-20 shrink-0 truncate text-white/60">
                  {points[0].agentLabel} → {points[0].otherLabel}
                </span>
                <Sparkline points={points.map((p) => p.affinity)} />
                <span className="w-8 shrink-0 text-right text-white/40">{points[points.length - 1].affinity}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
