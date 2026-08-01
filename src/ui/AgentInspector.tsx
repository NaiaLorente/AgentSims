import { useSimStore } from '../state/simStore';
import { recentMemories } from '../sim/memory';

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

export function AgentInspector() {
  const selectedAgentId = useSimStore((s) => s.selectedAgentId);
  const agent = useSimStore((s) => (s.selectedAgentId ? s.agents[s.selectedAgentId] : null));
  const agents = useSimStore((s) => s.agents);
  const selectAgent = useSimStore((s) => s.selectAgent);
  const agentOrder = useSimStore((s) => s.agentOrder);

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
            <p className="mt-1 text-[11px] text-white/40">Currently: {activityLabel(agent.activity.kind)}</p>
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
