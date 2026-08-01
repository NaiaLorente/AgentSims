import type { OllamaConfig } from './settings';

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

export interface ChatOptions {
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
export async function ollamaChat(
  config: OllamaConfig,
  temperature: number,
  opts: ChatOptions,
): Promise<string> {
  if (!config.model) throw new OllamaError('No model selected');

  const res = await fetch(`${trimBaseUrl(config.baseUrl)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      model: config.model,
      stream: false,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      format: opts.schema ?? 'json',
      options: { temperature },
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
