import { useSimStore, type SimState } from '../state/simStore';
import type { Agent } from '../sim/types';
import { derivedMetrics, TOTAL_ACTION_KINDS } from '../sim/metrics';

/**
 * A point-in-time summary you can save and look back at after a run, rather than needing the
 * live dashboard open — which disappears the moment the tab closes or Reset is hit. Pulls
 * entirely from data already tracked (modelStats, populationHistory, the event log); nothing
 * new is measured just for the report.
 */
export function buildRunReport(state: SimState): string {
  const lines: string[] = [];

  lines.push('# AgentSims run report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Run length: ${state.clock.tick} ticks`);
  lines.push(`Population at end: ${state.agentOrder.length}`);
  lines.push('');

  lines.push('## Population arc');
  lines.push('');
  if (state.populationHistory.length === 0) {
    lines.push('No population changes recorded.');
  } else {
    lines.push('| Tick | Population |');
    lines.push('| ---- | ---------- |');
    for (const point of state.populationHistory) {
      lines.push(`| ${point.tick} | ${point.count} |`);
    }
  }
  lines.push('');

  lines.push('## Model comparison');
  lines.push('');
  const modelsList = Object.values(state.modelStats);
  if (modelsList.length === 0) {
    lines.push('No model activity recorded yet.');
  } else {
    for (const stats of modelsList) {
      const agentsForModel = state.agentOrder
        .map((id) => state.agents[id])
        .filter((a): a is Agent => a?.model === stats.model);
      const derived = derivedMetrics(agentsForModel);
      const actionDiversity = Object.keys(stats.actionCounts).length;

      lines.push(`### ${stats.model}`);
      lines.push('');
      lines.push(`- Agents currently alive: ${agentsForModel.length}`);
      lines.push(`- Messages spoken: ${stats.messagesSpoken}`);
      lines.push(`- Money earned / spent / given: $${stats.moneyEarned} / $${stats.moneySpent} / $${stats.moneyGiven}`);
      lines.push(`- Houses lost: ${stats.housesLost}`);
      lines.push(`- Collapsed (permanently removed): ${stats.collapses ?? 0}`);
      lines.push(`- Actions used: ${actionDiversity}/${TOTAL_ACTION_KINDS}`);
      if (derived) {
        lines.push(`- Avg condition right now: ${Math.round(derived.avgCondition)}`);
        lines.push(`- Avg needs right now: ${Math.round(derived.avgNeeds)}`);
        lines.push(`- Avg wallet right now: $${Math.round(derived.avgWallet)}`);
        lines.push(`- Avg relationships formed: ${derived.avgRelationships.toFixed(1)}`);
        if (derived.avgAffinity !== null) {
          lines.push(`- Avg affinity toward others: ${Math.round(derived.avgAffinity)}`);
        }
      }
      const topActions = Object.entries(stats.actionCounts).sort((a, b) => b[1] - a[1]);
      if (topActions.length > 0) {
        lines.push(`- Action breakdown: ${topActions.map(([kind, count]) => `${kind.replace(/_/g, ' ')} (${count})`).join(', ')}`);
      }
      lines.push('');
    }
  }

  lines.push('## Key events');
  lines.push('');
  const events = state.log.filter((e) => e.kind === 'event');
  if (events.length === 0) {
    lines.push('No notable events yet.');
  } else {
    for (const e of events) {
      lines.push(`- **tick ${e.tick}** — ${e.text}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

/** Triggers a browser download of the current run's report — no backend involved, just a Blob
 *  and a throwaway object URL, consistent with this being a static, serverless app. */
export function downloadRunReport(): void {
  const state = useSimStore.getState();
  const markdown = buildRunReport(state);
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `agentsims-report-tick${state.clock.tick}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
