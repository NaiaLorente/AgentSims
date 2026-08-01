import { useEffect, useRef } from 'react';
import { useSimStore } from '../state/simStore';
import type { ActiveConversation } from '../sim/types';

function ConversationCard({ conversation }: { conversation: ActiveConversation }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [conversation.lines.length]);

  return (
    <div className="flex w-72 shrink-0 flex-col gap-1.5 rounded-lg border border-sky-500/20 bg-sky-500/5 p-2.5">
      <div className="text-xs font-semibold text-sky-300">
        {conversation.participantLabels[0]} ↔ {conversation.participantLabels[1]}
      </div>
      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto pr-1 text-xs">
        {conversation.lines.length === 0 && <p className="text-white/40">…</p>}
        {conversation.lines.map((line, i) => (
          <div key={i}>
            <span className="font-medium text-white/70">{line.speakerLabel}:</span>{' '}
            <span className="text-white/60">{line.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

/**
 * Simultaneous pairwise conversations are normal once there are 3+ agents —
 * this gives each one its own visible thread so they don't blur together
 * into one hard-to-follow flat feed.
 */
export function LiveConversations() {
  const activeConversations = useSimStore((s) => s.activeConversations);
  const conversations = Object.values(activeConversations);

  if (conversations.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {conversations.map((c) => (
        <ConversationCard key={c.id} conversation={c} />
      ))}
    </div>
  );
}
