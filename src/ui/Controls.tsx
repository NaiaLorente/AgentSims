import { useSimStore } from '../state/simStore';
import { saveToLocalStorage, loadFromLocalStorage, hasSavedGame } from '../persistence/saveLoad';
import { downloadRunReport } from '../persistence/runReport';

const SPEEDS = [
  { label: '0.5x', value: 0.5 },
  { label: '1x', value: 1 },
  { label: '2x', value: 2 },
  { label: '4x', value: 4 },
];

export function Controls() {
  const running = useSimStore((s) => s.clock.running);
  const ticksPerSecond = useSimStore((s) => s.clock.ticksPerSecond);
  const tick = useSimStore((s) => s.clock.tick);
  const play = useSimStore((s) => s.play);
  const pause = useSimStore((s) => s.pause);
  const setSpeed = useSimStore((s) => s.setSpeed);
  const reset = useSimStore((s) => s.reset);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <button
        onClick={() => (running ? pause() : play())}
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500"
      >
        {running ? '⏸ Pause' : '▶ Play'}
      </button>

      <div className="flex items-center gap-1">
        {SPEEDS.map((s) => (
          <button
            key={s.value}
            onClick={() => setSpeed(s.value)}
            className={`rounded-md px-2 py-1 text-xs ${
              ticksPerSecond === s.value ? 'bg-indigo-600' : 'bg-white/10 hover:bg-white/20'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <span className="ml-2 text-xs text-white/60">Tick {tick}</span>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => saveToLocalStorage()}
          className="rounded-md bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20"
        >
          💾 Save
        </button>
        <button
          disabled={!hasSavedGame()}
          onClick={() => loadFromLocalStorage()}
          className="rounded-md bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20 disabled:opacity-40"
        >
          📂 Load
        </button>
        <button
          onClick={() => downloadRunReport()}
          title="Download a Markdown summary of the run so far — population arc, per-model numbers, and key events"
          className="rounded-md bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20"
        >
          📄 Report
        </button>
        <button
          onClick={() => {
            // Auto-resume (loop.ts) would otherwise silently bring back the pre-reset run the
            // next time this page loads — overwrite the checkpoint with the freshly reset state.
            if (confirm('Reset the whole simulation? This cannot be undone.')) {
              reset();
              saveToLocalStorage();
            }
          }}
          className="rounded-md bg-red-600/80 px-3 py-1.5 text-xs hover:bg-red-500"
        >
          ⟲ Reset
        </button>
      </div>
    </div>
  );
}
