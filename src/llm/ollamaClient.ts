export interface OllamaSettings {
  baseUrl: string;
  model: string;
  temperature: number;
}

export const DEFAULT_SETTINGS: OllamaSettings = {
  baseUrl: 'http://localhost:11434',
  model: '',
  temperature: 0.8,
};

export class OllamaError extends Error {}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export async function listModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${trimBaseUrl(baseUrl)}/api/tags`);
  if (!res.ok) throw new OllamaError(`Ollama returned ${res.status}`);
  const data = (await res.json()) as { models?: { name: string }[] };
  return (data.models ?? []).map((m) => m.name);
}

export async function testConnection(baseUrl: string): Promise<boolean> {
  try {
    await listModels(baseUrl);
    return true;
  } catch {
    return false;
  }
}

interface ChatOptions {
  system: string;
  user: string;
  schema?: object;
  signal?: AbortSignal;
}

/**
 * Calls Ollama's /api/chat with an optional JSON schema for structured
 * output (supported by Ollama 0.5+, ignored gracefully by older servers
 * which will just receive `format: "json"`).
 */
export async function ollamaChat(settings: OllamaSettings, opts: ChatOptions): Promise<string> {
  if (!settings.model) throw new OllamaError('No model selected');

  const res = await fetch(`${trimBaseUrl(settings.baseUrl)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      model: settings.model,
      stream: false,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      format: opts.schema ?? 'json',
      options: { temperature: settings.temperature },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new OllamaError(`Ollama request failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  const content = data.message?.content;
  if (!content) throw new OllamaError('Empty response from Ollama');
  return content;
}

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

/**
 * Runs a JSON-structured chat call and parses the result, falling back to
 * `fallback` on any network/parse error so the sim loop never gets stuck
 * waiting on a flaky local model.
 */
export async function chatJSON<T>(
  settings: OllamaSettings,
  opts: Omit<ChatOptions, 'schema'> & { schema?: object },
  fallback: T,
): Promise<T> {
  try {
    const raw = await ollamaChat(settings, opts);
    return JSON.parse(extractJson(raw)) as T;
  } catch (err) {
    console.warn('[ollama] chatJSON failed, using fallback:', err);
    return fallback;
  }
}
