import { useSimStore } from '../state/simStore';
import { recentMemories } from '../sim/memory';
import { WORSE_OFF_THRESHOLD, type Agent } from '../sim/types';

function activityLabel(kind: string): string {
  switch (kind) {
    case 'idle':
      return 'Idle';
    case 'thinking':
      return 'Deciding…';
    case 'walking':
      return 'Walking';
    case 'talking':
      return 'Talking';
    default:
      return kind;
  }
}

const NEED_LABELS: Record<keyof Agent['needs'], string> = {
  hunger: 'Hunger',
  energy: 'Energy',
  social: 'Social',
  fun: 'Fun',
};

function needBarColor(value: number): string {
  if (value >= 70) return '#22c55e';
  if (value >= 40) return '#eab308';
  return '#ef4444';
}

/** Mirrors the actual thresholds in sim/loop.ts (shouldStepThisTick / moveStepFor) — these
 *  needs aren't just flavor text, so the UI should say when they're actually slowing things down. */
function consequenceHint(key: keyof Agent['needs'], value: number): string | null {
  if (key === 'energy') {
    if (value < 12) return 'moving much slower';
    if (value < 30) return 'moving slower';
  }
  if (key === 'hunger' || key === 'fun') {
    if (value < 15) return 'much shorter moves';
    if (value < 35) return 'shorter moves';
  }
  return null;
}

function NeedsBars({ needs }: { needs: Agent['needs'] }) {
  return (
    <div className="flex flex-col gap-1">
      {(Object.keys(needs) as (keyof Agent['needs'])[]).map((key) => {
        const value = needs[key];
        const hint = consequenceHint(key, value);
        return (
          <div key={key} className="flex items-center gap-2 text-[11px]">
            <span className="w-12 shrink-0 text-white/50">{NEED_LABELS[key]}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-[width]"
                style={{ width: `${Math.round(value)}%`, backgroundColor: needBarColor(value) }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-white/40">{Math.round(value)}</span>
            {hint && <span className="shrink-0 text-orange-400/70">{hint}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** The lasting-stakes stat, separate from the needs above — only moves from sustained neglect,
 *  not a momentary dip, so it stays flat most of the time and is worth calling out when it isn't. */
function conditionHint(value: number): string | null {
  if (value <= 0) return 'hit rock bottom — any house owned is at risk';
  if (value < WORSE_OFF_THRESHOLD) return 'visibly worn down from neglect';
  return null;
}

function ConditionBar({ value }: { value: number }) {
  const hint = conditionHint(value);
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-12 shrink-0 text-white/50">Condition</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${Math.round(value)}%`, backgroundColor: needBarColor(value) }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-white/40">{Math.round(value)}</span>
      {hint && <span className="shrink-0 text-orange-400/70">{hint}</span>}
    </div>
  );
}

/** One color-graded meter per relationship, hostile to loving, driven by the real affinity
 *  score — deliberately not a separate hardcoded "friendship"/"love" axis the engine tracks;
 *  the agent's own free-text label already carries that nuance, this just makes the one real
 *  number underneath it visible at a glance. */
function affinityColor(v: number): string {
  if (v >= 60) return '#ec4899'; // loving
  if (v >= 20) return '#22c55e'; // friendly
  if (v > -20) return '#94a3b8'; // neutral
  if (v > -60) return '#f97316'; // tense
  return '#ef4444'; // hostile
}

function RelationshipBar({ affinity }: { affinity: number }) {
  const pos = 50 + affinity / 2; // -100..100 -> 0..100%
  const left = Math.min(50, pos);
  const width = Math.abs(pos - 50);
  return (
    <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
      <div className="absolute inset-y-0 w-px bg-white/25" style={{ left: '50%' }} />
      <div className="absolute inset-y-0 rounded-full" style={{ left: `${left}%`, width: `${width}%`, backgroundColor: affinityColor(affinity) }} />
    </div>
  );
}

export function AgentInspector() {
  const selectedAgentId = useSimStore((s) => s.selectedAgentId);
  const agent = useSimStore((s) => (s.selectedAgentId ? s.agents[s.selectedAgentId] : null));
  const agents = useSimStore((s) => s.agents);
  const selectAgent = useSimStore((s) => s.selectAgent);
  const agentOrder = useSimStore((s) => s.agentOrder);
  const zones = useSimStore((s) => s.zones);
  const ownedHouses = zones.filter((z) => z.kind === 'house' && z.ownerId === selectedAgentId);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-white/60">Agents</h2>
      <div className="flex flex-wrap gap-1">
        {agentOrder.map((id) => {
          const a = agents[id];
          if (!a) return null;
          return (
            <button
              key={id}
              onClick={() => selectAgent(id)}
              className={`rounded-md px-2 py-1 text-xs ${
                selectedAgentId === id ? 'bg-indigo-600' : 'bg-white/10 hover:bg-white/20'
              }`}
              style={{ borderLeft: `3px solid ${a.color}` }}
            >
              {a.label}
            </button>
          );
        })}
      </div>

      {!agent && <p className="text-xs text-white/50">Click an agent (on the map or above) to inspect it.</p>}

      {agent && (
        <div className="flex flex-col gap-3">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: agent.color }} aria-hidden />
              {agent.label}
            </div>
            <p className="text-xs text-white/60">
              Model: <span className="text-white/80">{agent.model || '(none assigned)'}</span>
            </p>
            <p className="mt-1 text-[11px] text-white/40">
              Currently: {activityLabel(agent.activity.kind)} · ${agent.wallet}
              {ownedHouses.length > 0 && <> · owns {ownedHouses.map((h) => h.name).join(', ')}</>}
            </p>
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/60">Status</h3>
            <NeedsBars needs={agent.needs} />
            <div className="mt-1.5 border-t border-white/10 pt-1.5">
              <ConditionBar value={agent.condition} />
            </div>
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/60">Roles</h3>
            {agent.roles.length === 0 ? (
              <p className="text-[11px] text-white/30">None claimed yet.</p>
            ) : (
              <ul className="flex flex-col gap-0.5 text-[11px] text-white/60">
                {agent.roles.map((r, i) => (
                  <li key={i}>
                    "{r.title}" <span className="text-white/30">at {r.zoneId}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/60">Relationships</h3>
            {Object.keys(agent.relationships).length === 0 ? (
              <p className="text-[11px] text-white/30">Hasn't formed any yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {Object.values(agent.relationships).map((r) => (
                  <li key={r.otherId} className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between text-[11px] text-white/60">
                      <span>
                        <span className="text-white/80">{r.otherLabel}</span>: {r.label}
                      </span>
                      <span className="text-white/30">{r.affinity}</span>
                    </div>
                    <RelationshipBar affinity={r.affinity} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/60">Reflections</h3>
            {agent.reflections.length === 0 ? (
              <p className="text-[11px] text-white/30">Nothing yet — these build up periodically.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-[11px] text-indigo-200/70">
                {[...agent.reflections].reverse().map((r) => (
                  <li key={r.id}>{r.text}</li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/60">Recent history</h3>
            <ul className="flex flex-col gap-1 text-[11px] text-white/50">
              {recentMemories(agent, 12).map((m) => (
                <li key={m.id}>
                  <span className="text-white/30">[{m.kind}]</span> {m.text}
                </li>
              ))}
              {agent.memory.length === 0 && <li className="text-white/30">Nothing yet.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
