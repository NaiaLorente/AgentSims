import { useSimStore } from '../state/simStore';

const NATURAL_COLORS: Record<string, string> = {
  water: '#38bdf8',
  fire: '#f97316',
  wood: '#a16207',
  stone: '#9ca3af',
};

export function WorldPanel() {
  const worldObjects = useSimStore((s) => s.worldObjects);

  const sorted = [...worldObjects].sort((a, b) => a.tick - b.tick);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-white/60">
        World <span className="normal-case text-white/30">— everything made or found, in full</span>
      </h2>
      {sorted.length === 0 && <p className="text-xs text-white/40">Nothing yet.</p>}
      <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
        {sorted.map((o) => (
          <li key={o.id} className="rounded-md bg-black/20 p-2 text-xs">
            <div className="flex items-start gap-1.5">
              <span
                className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: o.natural ? (NATURAL_COLORS[o.content] ?? '#94a3b8') : '#34d399' }}
                aria-hidden
              />
              <span className="text-white/80">
                {o.natural ? (
                  <span className="capitalize">{o.content}</span>
                ) : (
                  <>
                    <span className="text-white/50">{o.creatorLabel} made:</span> "{o.content}"
                  </>
                )}
              </span>
            </div>
            {o.additions.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                {o.additions.map((add, i) => (
                  <li key={i} className="text-white/60">
                    <span className="text-white/40">{add.agentLabel}:</span> "{add.content}"
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
