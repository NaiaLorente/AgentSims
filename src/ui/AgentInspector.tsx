import { useSimStore } from '../state/simStore';
import { stageLabel } from '../sim/relationships';
import { recentMemories } from '../sim/memory';
import type { Needs } from '../sim/types';

function NeedBar({ label, value }: { label: string; value: number }) {
  const color = value >= 60 ? 'bg-emerald-500' : value >= 30 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 text-white/60">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="w-7 text-right text-white/50">{Math.round(value)}</span>
    </div>
  );
}

const NEED_LABELS: Record<keyof Needs, string> = {
  energy: 'Energy',
  hunger: 'Hunger',
  social: 'Social',
  fun: 'Fun',
};

function activityLabel(kind: string): string {
  switch (kind) {
    case 'idle':
      return 'Idle';
    case 'thinking':
      return 'Deciding…';
    case 'walking':
      return 'Walking';
    case 'sleeping':
      return 'Sleeping';
    case 'eating':
      return 'Eating';
    case 'relaxing':
      return 'Relaxing';
    case 'talking':
      return 'Talking';
    default:
      return kind;
  }
}

export function AgentInspector() {
  const selectedAgentId = useSimStore((s) => s.selectedAgentId);
  const agent = useSimStore((s) => (s.selectedAgentId ? s.agents[s.selectedAgentId] : null));
  const agents = useSimStore((s) => s.agents);
  const selectAgent = useSimStore((s) => s.selectAgent);
  const agentOrder = useSimStore((s) => s.agentOrder);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-white/60">Residents</h2>
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
            >
              {a.emoji} {a.name}
            </button>
          );
        })}
      </div>

      {!agent && <p className="text-xs text-white/50">Click a resident (on the map or above) to inspect them.</p>}

      {agent && (
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-base font-semibold">
              {agent.emoji} {agent.name}
              {agent.isChild && <span className="ml-1 text-xs text-white/50">(child)</span>}
            </div>
            <p className="text-xs text-white/60">{agent.persona.bio}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {agent.persona.traits.map((t) => (
                <span key={t} className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-white/40">Currently: {activityLabel(agent.activity.kind)}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            {(Object.keys(NEED_LABELS) as (keyof Needs)[]).map((k) => (
              <NeedBar key={k} label={NEED_LABELS[k]} value={agent.needs[k]} />
            ))}
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/60">Relationships</h3>
            {Object.keys(agent.relationships).length === 0 && (
              <p className="text-xs text-white/40">No relationships yet.</p>
            )}
            <ul className="flex flex-col gap-1">
              {Object.values(agent.relationships)
                .sort((a, b) => b.affinity - a.affinity)
                .map((rel) => {
                  const other = agents[rel.otherId];
                  if (!other) return null;
                  return (
                    <li key={rel.otherId} className="flex items-center justify-between text-xs">
                      <button className="text-white/80 hover:underline" onClick={() => selectAgent(other.id)}>
                        {other.emoji} {other.name}
                      </button>
                      <span className="text-white/50">
                        {stageLabel(rel.stage)} ({rel.affinity})
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/60">Recent memories</h3>
            <ul className="flex flex-col gap-1 text-[11px] text-white/50">
              {recentMemories(agent, 8).map((m) => (
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
