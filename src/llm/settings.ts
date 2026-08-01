export type Backend = 'ollama' | 'nvidia';

export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

export interface NvidiaConfig {
  apiKey: string;
  model: string;
}

export interface LLMSettings {
  backend: Backend;
  temperature: number;
  ollama: OllamaConfig;
  nvidia: NvidiaConfig;
}

export const DEFAULT_LLM_SETTINGS: LLMSettings = {
  backend: 'ollama',
  temperature: 0.8,
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: '',
  },
  nvidia: {
    apiKey: '',
    model: 'meta/llama-3.1-8b-instruct',
  },
};

const SETTINGS_STORAGE_KEY = 'agentsims:llm-settings:v1';

/** Loads persisted settings (including the NVIDIA API key) from localStorage, if any. */
export function loadPersistedSettings(): LLMSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_LLM_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      backend: parsed.backend === 'nvidia' ? 'nvidia' : 'ollama',
      temperature: typeof parsed.temperature === 'number' ? parsed.temperature : DEFAULT_LLM_SETTINGS.temperature,
      ollama: { ...DEFAULT_LLM_SETTINGS.ollama, ...parsed.ollama },
      nvidia: { ...DEFAULT_LLM_SETTINGS.nvidia, ...parsed.nvidia },
    };
  } catch {
    return DEFAULT_LLM_SETTINGS;
  }
}

/** Settings (including the API key) never leave the browser except to the chosen LLM endpoint itself. */
export function persistSettings(settings: LLMSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // best-effort; ignore quota/private-mode errors
  }
}
