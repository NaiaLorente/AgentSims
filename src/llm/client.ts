import type { LLMSettings } from './settings';
import { ollamaChat } from './ollamaClient';
import { nvidiaChat } from './nvidiaClient';
import { extractJson } from './json';

export interface ChatJsonOptions {
  system: string;
  user: string;
  schema?: object; // only used by backends that support structured output (Ollama)
  signal?: AbortSignal;
}

async function rawChat(settings: LLMSettings, opts: ChatJsonOptions): Promise<string> {
  if (settings.backend === 'nvidia') {
    return nvidiaChat(settings.nvidia, settings.temperature, opts);
  }
  return ollamaChat(settings.ollama, settings.temperature, opts);
}

/**
 * Runs a JSON-structured chat call against whichever backend is active and
 * parses the result, falling back to `fallback` on any network/parse error
 * so the sim loop never gets stuck waiting on a flaky model or connection.
 */
export async function chatJSON<T>(settings: LLMSettings, opts: ChatJsonOptions, fallback: T): Promise<T> {
  try {
    const raw = await rawChat(settings, opts);
    return JSON.parse(extractJson(raw)) as T;
  } catch (err) {
    console.warn(`[llm:${settings.backend}] chatJSON failed, using fallback:`, err);
    return fallback;
  }
}
