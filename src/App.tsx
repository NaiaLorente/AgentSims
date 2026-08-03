import { useEffect } from 'react';
import { CanvasWorld } from './render/CanvasWorld';
import { Controls } from './ui/Controls';
import { SettingsPanel } from './ui/SettingsPanel';
import { AgentInspector } from './ui/AgentInspector';
import { EventLog } from './ui/EventLog';
import { ZonesPanel } from './ui/ZonesPanel';
import { GovernancePanel } from './ui/GovernancePanel';
import { NoticeBoardPanel } from './ui/NoticeBoardPanel';
import { LiveConversations } from './ui/LiveConversations';
import { ModelDashboard } from './ui/ModelDashboard';
import { startLoopWatcher } from './sim/loop';
import { hasSavedGame, loadFromLocalStorage } from './persistence/saveLoad';

export default function App() {
  useEffect(() => {
    // Auto-resume: the sim saves itself every few ticks while running (see loop.ts), so a
    // closed tab, a sleeping laptop, or a crash loses at most a few ticks, not the whole run.
    if (hasSavedGame()) loadFromLocalStorage();
    startLoopWatcher();
  }, []);

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col gap-3 p-4">
      <header>
        <h1 className="text-xl font-semibold">AgentSims</h1>
        <p className="text-xs text-white/50">
          Several LLMs dropped into a shared town — houses, a shop, a restaurant, a park, a notice board — with
          needs, jobs, and relationships to manage, but total free will over what to actually do about any of it.
        </p>
      </header>

      <Controls />

      <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-3">
          <div className="flex justify-center overflow-auto rounded-lg bg-black/20 p-3">
            <CanvasWorld />
          </div>
          <LiveConversations />
          <div className="h-56">
            <EventLog />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <SettingsPanel />
          <AgentInspector />
          <ZonesPanel />
          <GovernancePanel />
          <NoticeBoardPanel />
        </div>
      </div>

      <ModelDashboard />
    </div>
  );
}
