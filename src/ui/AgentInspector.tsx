import { useSimStore } from '../state/simStore';
import { recentMemories } from '../sim/memory';
import type { Agent } from '../sim/types';

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
              <ul className="flex flex-col gap-0.5 text-[11px] text-white/60">
                {Object.values(agent.relationships).map((r) => (
                  <li key={r.otherId}>
                    <span className="text-white/80">{r.otherLabel}</span>: {r.label}{' '}
                    <span className="text-white/30">(affinity {r.affinity})</span>
                  </li>
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
