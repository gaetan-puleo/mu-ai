import type { ApiModel } from 'mu-core';
import OpenAI from 'openai';

/**
 * Field names different OpenAI-compatible servers use to report a model's
 * context window. Probed in order; the first numeric value wins.
 */
const CONTEXT_KEYS = [
  'context_length',
  'context_window',
  'max_context_length',
  'max_model_len',
  'max_position_embeddings',
  'n_ctx',
] as const;

const PROBE_TIMEOUT_MS = 2500;

function readContextLimit(raw: unknown): number | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  for (const key of CONTEXT_KEYS) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  }
  // Recurse into common metadata wrappers (llama-swap nests under
  // `default_generation_settings`, OpenAI compat servers sometimes use
  // `meta` / `metadata` / `params`).
  for (const nestedKey of ['default_generation_settings', 'meta', 'metadata', 'params']) {
    const nested = readContextLimit(obj[nestedKey]);
    if (nested) return nested;
  }
  return undefined;
}

/** Strip a trailing `/v1` (with optional slash) from the OpenAI base URL. */
function originRoot(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe llama.cpp / llama-swap style endpoints that expose the runtime
 * context window for a *loaded* model. Returns the first match; OpenAI
 * cloud (and most managed providers) won't have these — the function
 * silently gives up. Should only be called after the model has served a
 * request, otherwise it can trigger an on-demand model load on llama-swap.
 */
export async function fetchModelContextLimit(baseUrl: string, modelId: string): Promise<number | undefined> {
  const root = originRoot(baseUrl);
  const candidates = [
    // llama-swap: per-model upstream proxy
    `${root}/upstream/${encodeURIComponent(modelId)}/props`,
    // single-model llama.cpp server
    `${root}/props`,
  ];
  for (const url of candidates) {
    const body = await fetchJson(url);
    const ctx = readContextLimit(body);
    if (ctx) return ctx;
  }
  return undefined;
}

export async function listModels(baseUrl: string): Promise<ApiModel[]> {
  try {
    // Local OpenAI-compatible servers don't enforce auth; a placeholder
    // apiKey satisfies the SDK without leaking real credentials.
    const client = new OpenAI({ baseURL: baseUrl, apiKey: 'sk-local' });
    const list = await client.models.list();
    return list.data.map((m) => {
      // Only honour limits the server inlined in `/v1/models`. Probing
      // `/props` here would force every advertised model to load on
      // llama-swap-style proxies. The TUI lazily probes the active model
      // after its first usage event instead — see `useModelContextLimits`.
      const contextLimit = readContextLimit(m);
      return contextLimit ? { id: m.id, contextLimit } : { id: m.id };
    });
  } catch {
    return [];
  }
}
