import { useEffect, useRef } from 'react';
import { useSimStore } from '../state/simStore';

export function EventLog() {
  const log = useSimStore((s) => s.log);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [log.length]);

  return (
    <div className="flex h-full flex-col rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/60">
        Transcript <span className="normal-case text-white/30">— everything said and claimed, verbatim</span>
      </h2>
      <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
        {log.map((entry) => (
          <div key={entry.id} className="text-xs leading-snug">
            <span className="mr-1.5 text-white/30">#{entry.tick}</span>
            {entry.kind === 'conversation' && (
              <>
                <span className="font-semibold text-sky-300">
                  {entry.speakerLabel ?? 'Agent'}
                  {entry.listenerLabel && <span className="font-normal text-sky-300/60"> → {entry.listenerLabel}</span>}:
                </span>{' '}
                <span className="text-white/80">{entry.text}</span>
              </>
            )}
            {entry.kind === 'event' && <span className="text-emerald-300">{entry.text}</span>}
            {entry.kind === 'system' && <span className="text-white/40">{entry.text}</span>}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
