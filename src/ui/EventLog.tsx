import { useEffect, useRef } from 'react';
import { useSimStore } from '../state/simStore';

const KIND_STYLE: Record<string, string> = {
  milestone: 'text-amber-300',
  conversation: 'text-sky-300',
  system: 'text-white/40',
};

export function EventLog() {
  const log = useSimStore((s) => s.log);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [log.length]);

  return (
    <div className="flex h-full flex-col rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/60">Town feed</h2>
      <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
        {log.map((entry) => (
          <div key={entry.id} className="text-xs leading-snug">
            <span className="mr-1.5 text-white/30">#{entry.tick}</span>
            <span className={KIND_STYLE[entry.kind] ?? 'text-white/70'}>{entry.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
