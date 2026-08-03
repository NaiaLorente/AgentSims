import { useSimStore } from '../state/simStore';

/**
 * The one durable, public artifact in the town — unlike conversation, which only reaches whoever
 * happens to be nearby and only survives in the scrolling transcript, anything pinned here stays
 * up and every agent's planning prompt includes it, regardless of where they are. Posting still
 * requires physically standing at the board; reading never did.
 */
export function NoticeBoardPanel() {
  const notices = useSimStore((s) => s.notices);

  if (notices.length === 0) return null;

  const recent = [...notices].reverse().slice(0, 10);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-white/60">
        Notice board <span className="normal-case text-white/30">— pinned by agents, read by the whole town</span>
      </h2>
      <ul className="flex flex-col gap-2">
        {recent.map((n) => (
          <li key={n.id} className="rounded-md bg-black/20 p-2 text-xs">
            <div className="flex items-center justify-between text-white/40">
              <span className="text-white/70">{n.authorLabel}</span>
              <span>tick {n.tick}</span>
            </div>
            <p className="mt-0.5 text-white/80">"{n.text}"</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
