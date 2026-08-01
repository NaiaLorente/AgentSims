import { useEffect } from 'react';
import { CanvasWorld } from './render/CanvasWorld';
import { Controls } from './ui/Controls';
import { SettingsPanel } from './ui/SettingsPanel';
import { AgentInspector } from './ui/AgentInspector';
import { EventLog } from './ui/EventLog';
import { WorldPanel } from './ui/WorldPanel';
import { LiveConversations } from './ui/LiveConversations';
import { startLoopWatcher } from './sim/loop';

export default function App() {
  useEffect(() => {
    startLoopWatcher();
  }, []);

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col gap-3 p-4">
      <header>
        <h1 className="text-xl font-semibold">AgentSims</h1>
        <p className="text-xs text-white/50">
          Several LLMs dropped into a shared space with total free will — no personality, no goals, no rules.
          Watch what each model actually does.
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
          <WorldPanel />
        </div>
      </div>
    </div>
  );
}
