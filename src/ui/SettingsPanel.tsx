import { useState } from 'react';
import { useSimStore } from '../state/simStore';
import { listModels, testConnection } from '../llm/ollamaClient';
import { NVIDIA_SUGGESTED_MODELS, testNvidiaConnection } from '../llm/nvidiaClient';
import type { Backend } from '../llm/settings';

function StatusDot() {
  const connectionStatus = useSimStore((s) => s.connectionStatus);
  return (
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
  );
}

function OllamaSection() {
  const ollama = useSimStore((s) => s.settings.ollama);
  const setOllamaConfig = useSimStore((s) => s.setOllamaConfig);
  const availableModels = useSimStore((s) => s.availableModels);
  const setAvailableModels = useSimStore((s) => s.setAvailableModels);
  const connectionStatus = useSimStore((s) => s.connectionStatus);
  const connectionError = useSimStore((s) => s.connectionError);
  const setConnectionStatus = useSimStore((s) => s.setConnectionStatus);

  const [baseUrlDraft, setBaseUrlDraft] = useState(ollama.baseUrl);
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
      if (models.length > 0 && !models.includes(ollama.model)) {
        setOllamaConfig({ model: models[0] });
      }
    } catch (err) {
      setConnectionStatus('error', String(err));
    }
  }

  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-white/60">Base URL</span>
        <div className="flex gap-2">
          <input
            value={baseUrlDraft}
            onChange={(e) => setBaseUrlDraft(e.target.value)}
            onBlur={() => setOllamaConfig({ baseUrl: baseUrlDraft })}
            className="flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs"
            placeholder="http://localhost:11434"
          />
          <button
            onClick={() => {
              setOllamaConfig({ baseUrl: baseUrlDraft });
              void checkConnection(baseUrlDraft);
            }}
            className="rounded-md bg-indigo-600 px-2 py-1 text-xs hover:bg-indigo-500"
          >
            Test
          </button>
        </div>
      </label>

      <div className="flex items-center gap-2 text-xs">
        <StatusDot />
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
          value={ollama.model}
          onChange={(e) => setOllamaConfig({ model: e.target.value })}
          className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs"
        >
          {ollama.model && !availableModels.includes(ollama.model) && <option value={ollama.model}>{ollama.model}</option>}
          {availableModels.length === 0 && <option value="">(test connection to list models)</option>}
          {availableModels.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <div className="rounded-md bg-black/20 p-2 text-[11px] leading-relaxed text-white/50">
        Requires a local <strong>Ollama</strong> server (free, no API key, unlimited). Install it, then run{' '}
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
    </>
  );
}

function NvidiaSection() {
  const nvidia = useSimStore((s) => s.settings.nvidia);
  const setNvidiaConfig = useSimStore((s) => s.setNvidiaConfig);
  const connectionStatus = useSimStore((s) => s.connectionStatus);
  const connectionError = useSimStore((s) => s.connectionError);
  const setConnectionStatus = useSimStore((s) => s.setConnectionStatus);
  const [showKey, setShowKey] = useState(false);

  async function checkConnection() {
    setConnectionStatus('checking');
    const result = await testNvidiaConnection(nvidia);
    if (result.ok) setConnectionStatus('ok');
    else setConnectionStatus('error', result.error);
  }

  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-white/60">NVIDIA API key</span>
        <div className="flex gap-2">
          <input
            type={showKey ? 'text' : 'password'}
            value={nvidia.apiKey}
            onChange={(e) => setNvidiaConfig({ apiKey: e.target.value })}
            className="flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs"
            placeholder="nvapi-..."
            autoComplete="off"
          />
          <button
            onClick={() => setShowKey((v) => !v)}
            className="rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-white/60">Model</span>
        <input
          list="nvidia-model-suggestions"
          value={nvidia.model}
          onChange={(e) => setNvidiaConfig({ model: e.target.value })}
          className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs"
          placeholder="meta/llama-3.1-8b-instruct"
        />
        <datalist id="nvidia-model-suggestions">
          {NVIDIA_SUGGESTED_MODELS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-white/60">
          Proxy URL <span className="text-white/40">(needed — see below)</span>
        </span>
        <input
          value={nvidia.proxyUrl}
          onChange={(e) => setNvidiaConfig({ proxyUrl: e.target.value })}
          className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs"
          placeholder="https://your-worker.your-name.workers.dev"
        />
      </label>

      <button
        onClick={() => void checkConnection()}
        className="rounded-md bg-indigo-600 px-2 py-1 text-xs hover:bg-indigo-500 self-start"
      >
        Test
      </button>

      <div className="flex items-center gap-2 text-xs">
        <StatusDot />
        <span className="break-words text-white/60">
          {connectionStatus === 'ok' && 'Connected'}
          {connectionStatus === 'error' && (connectionError ?? 'Connection failed')}
          {connectionStatus === 'checking' && 'Checking…'}
          {connectionStatus === 'unknown' && 'Not tested yet'}
        </span>
      </div>

      <div className="rounded-md bg-black/20 p-2 text-[11px] leading-relaxed text-white/50">
        Get a free API key at{' '}
        <a href="https://build.nvidia.com" target="_blank" rel="noreferrer" className="underline">
          build.nvidia.com
        </a>{' '}
        (no local GPU needed). <strong>NVIDIA's API blocks direct browser requests</strong>, so you'll need a free
        CORS relay: deploy{' '}
        <code className="rounded bg-black/40 px-1">proxy/nvidia-cors-proxy.js</code> from the repo to a Cloudflare
        Worker (free, ~2 minutes, see the README) and paste its URL above. Your API key is only ever sent to that
        worker and to NVIDIA — never to us. Prefer smaller instruct models over big "reasoning" ones here — they
        respond faster for this turn-based sim.
      </div>
    </>
  );
}

const BACKENDS: { id: Backend; label: string }[] = [
  { id: 'ollama', label: 'Local (Ollama)' },
  { id: 'nvidia', label: 'Cloud (NVIDIA key)' },
];

export function SettingsPanel() {
  const backend = useSimStore((s) => s.settings.backend);
  const setBackend = useSimStore((s) => s.setBackend);
  const temperature = useSimStore((s) => s.settings.temperature);
  const setTemperature = useSimStore((s) => s.setTemperature);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-white/60">AI settings</h2>

      <div className="flex gap-1">
        {BACKENDS.map((b) => (
          <button
            key={b.id}
            onClick={() => setBackend(b.id)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs ${
              backend === b.id ? 'bg-indigo-600' : 'bg-white/10 hover:bg-white/20'
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {backend === 'ollama' ? <OllamaSection /> : <NvidiaSection />}

      <label className="flex flex-col gap-1">
        <span className="text-xs text-white/60">Temperature: {temperature.toFixed(1)}</span>
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.1}
          value={temperature}
          onChange={(e) => setTemperature(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
