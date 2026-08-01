import { useState } from 'react';
import { useSimStore } from '../state/simStore';
import { listModels, testConnection } from '../llm/ollamaClient';

export function SettingsPanel() {
  const settings = useSimStore((s) => s.settings);
  const setSettings = useSimStore((s) => s.setSettings);
  const availableModels = useSimStore((s) => s.availableModels);
  const setAvailableModels = useSimStore((s) => s.setAvailableModels);
  const connectionStatus = useSimStore((s) => s.connectionStatus);
  const connectionError = useSimStore((s) => s.connectionError);
  const setConnectionStatus = useSimStore((s) => s.setConnectionStatus);

  const [baseUrlDraft, setBaseUrlDraft] = useState(settings.baseUrl);
  const isHttpsPage = typeof window !== 'undefined' && window.location.protocol === 'https:';

  async function checkConnection(baseUrl: string) {
    setConnectionStatus('checking');
    const ok = await testConnection(baseUrl);
    if (!ok) {
      setConnectionStatus('error', 'Could not reach Ollama at this address.');
      return;
    }
    try {
      const models = await listModels(baseUrl);
      setAvailableModels(models);
      setConnectionStatus('ok');
      if (models.length > 0 && !models.includes(settings.model)) {
        setSettings({ model: models[0] });
      }
    } catch (err) {
      setConnectionStatus('error', String(err));
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-white/60">Ollama settings</h2>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-white/60">Base URL</span>
        <div className="flex gap-2">
          <input
            value={baseUrlDraft}
            onChange={(e) => setBaseUrlDraft(e.target.value)}
            onBlur={() => setSettings({ baseUrl: baseUrlDraft })}
            className="flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs"
            placeholder="http://localhost:11434"
          />
          <button
            onClick={() => {
              setSettings({ baseUrl: baseUrlDraft });
              void checkConnection(baseUrlDraft);
            }}
            className="rounded-md bg-indigo-600 px-2 py-1 text-xs hover:bg-indigo-500"
          >
            Test
          </button>
        </div>
      </label>

      <div className="flex items-center gap-2 text-xs">
        <span
          className={`h-2 w-2 rounded-full ${
            connectionStatus === 'ok'
              ? 'bg-emerald-400'
              : connectionStatus === 'error'
                ? 'bg-red-400'
                : connectionStatus === 'checking'
                  ? 'bg-yellow-400 animate-pulse'
                  : 'bg-white/30'
          }`}
        />
        <span className="text-white/60">
          {connectionStatus === 'ok' && 'Connected'}
          {connectionStatus === 'error' && (connectionError ?? 'Connection failed')}
          {connectionStatus === 'checking' && 'Checking…'}
          {connectionStatus === 'unknown' && 'Not tested yet'}
        </span>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-white/60">Model</span>
        <select
          value={settings.model}
          onChange={(e) => setSettings({ model: e.target.value })}
          className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs"
        >
          {settings.model && !availableModels.includes(settings.model) && (
            <option value={settings.model}>{settings.model}</option>
          )}
          {availableModels.length === 0 && <option value="">(test connection to list models)</option>}
          {availableModels.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-white/60">Temperature: {settings.temperature.toFixed(1)}</span>
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.1}
          value={settings.temperature}
          onChange={(e) => setSettings({ temperature: Number(e.target.value) })}
        />
      </label>

      <div className="rounded-md bg-black/20 p-2 text-[11px] leading-relaxed text-white/50">
        Requires a local <strong>Ollama</strong> server (free, no API key). Install it, then run{' '}
        <code className="rounded bg-black/40 px-1">ollama pull llama3.2</code> and start it with{' '}
        <code className="rounded bg-black/40 px-1">OLLAMA_ORIGINS=* ollama serve</code> so this page is allowed to
        call it.
        {isHttpsPage && (
          <>
            {' '}
            This page is loaded over https — if your browser blocks the request to http://localhost, run the app
            locally instead (<code className="rounded bg-black/40 px-1">npm run dev</code>) or allow insecure
            content for this site.
          </>
        )}
      </div>
    </div>
  );
}
