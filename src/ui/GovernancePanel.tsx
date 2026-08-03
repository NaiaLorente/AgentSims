import { useSimStore } from '../state/simStore';
import type { Proposal } from '../sim/types';

function statusColor(status: Proposal['status'], kind: Proposal['kind']): string {
  if (status === 'passed') return kind === 'admit' ? 'text-emerald-400/80' : 'text-red-400/80';
  if (status === 'failed') return 'text-white/40';
  return 'text-amber-400/80';
}

function statusLabel(status: Proposal['status'], kind: Proposal['kind']): string {
  if (status === 'passed') return kind === 'admit' ? 'Admitted' : 'Banished';
  if (status === 'failed') return kind === 'admit' ? 'Rejected' : 'Failed';
  return 'Open';
}

function ProposalRow({ proposal, tick }: { proposal: Proposal; tick: number }) {
  const total = proposal.votesFor.length + proposal.votesAgainst.length;
  const pct = total > 0 ? (proposal.votesFor.length / total) * 100 : 0;
  const verb = proposal.kind === 'admit' ? 'admit' : 'banish';
  return (
    <li className="rounded-md bg-black/20 p-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-white/80">
          {proposal.proposerLabel} → {verb} {proposal.targetLabel}
        </span>
        <span className={statusColor(proposal.status, proposal.kind)}>{statusLabel(proposal.status, proposal.kind)}</span>
      </div>
      <p className="mt-0.5 text-white/50">"{proposal.reason}"</p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="flex h-full">
          <div className={`h-full ${proposal.kind === 'admit' ? 'bg-emerald-500/70' : 'bg-red-500/70'}`} style={{ width: `${pct}%` }} />
          <div className="h-full bg-white/20" style={{ width: `${100 - pct}%` }} />
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between text-white/40">
        <span>
          {proposal.votesFor.length} for, {proposal.votesAgainst.length} against
        </span>
        {proposal.status === 'open' && <span>{Math.max(0, proposal.resolvesAtTick - tick)} ticks left</span>}
      </div>
    </li>
  );
}

/**
 * Two forms of politics with real teeth: any agent can propose banishing a member, or admitting
 * a candidate waiting in the roster's "waiting room" — either way, if a majority of the current
 * active town votes for it before the window closes, it actually, permanently happens. Everything
 * else ("leader of the park") stays purely self-declared — these are the only mechanisms where a
 * vote changes who's actually in the town.
 */
export function GovernancePanel() {
  const proposals = useSimStore((s) => s.proposals);
  const tick = useSimStore((s) => s.clock.tick);
  const agents = useSimStore((s) => s.agents);

  const pendingWithoutProposal = Object.values(agents).filter(
    (a) => a?.pending && !proposals.some((p) => p.status === 'open' && p.targetId === a.id),
  );

  if (proposals.length === 0 && pendingWithoutProposal.length === 0) return null;

  const open = proposals.filter((p) => p.status === 'open');
  const resolved = [...proposals.filter((p) => p.status !== 'open')].reverse().slice(0, 5);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-white/60">
        Governance <span className="normal-case text-white/30">— banishment and admission, decided by majority vote</span>
      </h2>
      {pendingWithoutProposal.length > 0 && (
        <p className="text-[11px] text-white/40">
          Waiting to join, no vote yet: {pendingWithoutProposal.map((a) => a?.label).join(', ')}
        </p>
      )}
      {open.length === 0 && resolved.length === 0 ? (
        <p className="text-[11px] text-white/30">No proposals yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {open.map((p) => (
            <ProposalRow key={p.id} proposal={p} tick={tick} />
          ))}
          {resolved.map((p) => (
            <ProposalRow key={p.id} proposal={p} tick={tick} />
          ))}
        </ul>
      )}
    </div>
  );
}
