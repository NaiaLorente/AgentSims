import type { NvidiaConfig } from './settings';

const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

export class NvidiaError extends Error {}

/**
 * A curated shortlist of build.nvidia.com's free-tier chat/instruct models
 * that are fast enough for a turn-based sim (avoid the big "reasoning"
 * models here — they're great but slow for many small per-agent calls).
 * Shown as autocomplete suggestions; any model id from the catalog works.
 */
export const NVIDIA_SUGGESTED_MODELS = [
  'meta/llama-3.1-8b-instruct',
  'meta/llama-3.3-70b-instruct',
  'nvidia/nemotron-3-nano-30b-a3b',
  'nvidia/llama-3.3-nemotron-super-49b-v1.5',
  'qwen/qwen3-next-80b-a3b-instruct',
  'mistralai/mistral-medium-3.5-128b',
  'google/gemma-4-31b-it',
  'deepseek-ai/deepseek-v4-flash',
  'openai/gpt-oss-20b',
];

export interface ChatOptions {
  system: string;
  user: string;
  signal?: AbortSignal;
}

async function callChatCompletions(
  config: NvidiaConfig,
  temperature: number,
  opts: ChatOptions,
  useJsonMode: boolean,
): Promise<Response> {
  return fetch(NVIDIA_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    signal: opts.signal,
    body: JSON.stringify({
      model: config.model,
      stream: false,
      temperature,
      max_tokens: 500,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
}

/**
 * Calls NVIDIA's OpenAI-compatible chat completions endpoint directly from
 * the browser with the user's own API key. Not every model in the catalog
 * accepts `response_format: json_object`, so on a non-OK response we retry
 * once without it before giving up.
 */
export async function nvidiaChat(config: NvidiaConfig, temperature: number, opts: ChatOptions): Promise<string> {
  if (!config.apiKey) throw new NvidiaError('No NVIDIA API key set');
  if (!config.model) throw new NvidiaError('No model selected');

  let res: Response;
  try {
    res = await callChatCompletions(config, temperature, opts, true);
    if (!res.ok) {
      res = await callChatCompletions(config, temperature, opts, false);
    }
  } catch (err) {
    throw new NvidiaError(
      `Could not reach NVIDIA's API from the browser: ${String(err)}. This can happen if the browser blocks the ` +
        `request (CORS) or you're offline — try the local Ollama mode if this keeps failing.`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new NvidiaError(`NVIDIA API request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new NvidiaError('Empty response from NVIDIA API');
  return content;
}

export async function testNvidiaConnection(
  config: NvidiaConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await nvidiaChat(config, 0, {
      system: 'Respond only with this exact JSON: {"ok":true}',
      user: 'ping',
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
