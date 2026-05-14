/**
 * Model listing and per-kind discovery helpers for mu-local-provider.
 *
 * - `listModels(baseUrl)` calls the OpenAI `/v1/models` endpoint via the
 *   official SDK and returns the bare ids advertised by the server. This
 *   is the same endpoint mu-openai-provider used; it's part of the
 *   OpenAI spec and works against any compatible server.
 *
 * - `getModelInfo(baseUrl, modelId)` is dispatched on the detected
 *   `LocalServerKind` (see `detect.ts`) and yields the *runtime* context
 *   window for the given model when available. Both llama-server-based
 *   kinds expose the same shape under `/props`:
 *
 *     | kind         | endpoint                            | field                                        |
 *     |--------------|-------------------------------------|----------------------------------------------|
 *     | llama-swap   | `GET /upstream/<id>/props`          | `default_generation_settings.params.n_ctx`   |
 *     | llama-cpp    | `GET /props`                        | `default_generation_settings.params.n_ctx`   |
 *     | unknown      | (no probe)                          | —                                            |
 *
 *   Unifying on `/props` keeps the two kinds on the *canonical* llama.cpp
 *   introspection endpoint and lets a single parser cover both. The
 *   alternative we previously considered (`/upstream/<id>/slots`, flatter
 *   shape, smaller payload) was rejected for consistency: `/props` is
 *   the documented stable surface, while `/slots` is a runtime-state
 *   endpoint that incidentally leaks `n_ctx` and may slim down later.
 *
 *   We deliberately surface `n_ctx` (runtime) NOT `n_ctx_train`
 *   (architectural maximum). The runtime number is what fills up; the
 *   trained max is misleading for "is my context full?" UX.
 *
 * All non-OpenAI probes silently fail to `undefined`. Errors never throw
 * out of `getModelInfo` — the caller treats missing data as "no total".
 */

import OpenAI from 'openai';
import { detectServer, type LocalServerKind, originRoot } from './detect';

const DISCOVERY_TIMEOUT_MS = 1500;

export interface ApiModel {
  /** Bare model id as returned by the server. */
  id: string;
}

export interface LocalModelInfo {
  id: string;
  /**
   * The runtime context window the server is configured to serve (e.g.
   * llama-server's `--ctx-size`). Absent when discovery isn't supported
   * for the detected kind, or when the probe fails.
   */
  runtimeContextLimit?: number;
}

async function fetchJsonWithTimeout(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read `n_ctx` from any llama.cpp-style `/props` response body. Tolerates
 * both shapes seen in the wild:
 *   - `default_generation_settings.n_ctx`           (older builds)
 *   - `default_generation_settings.params.n_ctx`    (current builds, incl. llama-swap)
 *
 * Returns `undefined` for unrelated bodies, missing fields, or non-
 * positive numbers — discovery is best-effort.
 */
function readNCtxFromProps(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const dgs = (body as Record<string, unknown>).default_generation_settings;
  if (!dgs || typeof dgs !== 'object') return undefined;
  const direct = (dgs as Record<string, unknown>).n_ctx;
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return direct;
  const params = (dgs as Record<string, unknown>).params;
  if (params && typeof params === 'object') {
    const n = (params as Record<string, unknown>).n_ctx;
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

/**
 * Build the `/props` URL for a given server kind. llama-swap fronts each
 * loaded model under `/upstream/<id>/`; standalone llama-server exposes
 * `/props` at the root.
 */
function propsUrl(kind: LocalServerKind, root: string, modelId: string): string | undefined {
  if (kind === 'llama-swap') return `${root}/upstream/${encodeURIComponent(modelId)}/props`;
  if (kind === 'llama-cpp') return `${root}/props`;
  return undefined;
}

async function discoverContext(
  kind: LocalServerKind,
  baseUrl: string,
  modelId: string,
): Promise<number | undefined> {
  const url = propsUrl(kind, originRoot(baseUrl), modelId);
  if (!url) return undefined;
  const body = await fetchJsonWithTimeout(url);
  return readNCtxFromProps(body);
}

export async function listModels(baseUrl: string): Promise<ApiModel[]> {
  // Local OpenAI-compatible servers don't enforce auth; a placeholder
  // apiKey satisfies the SDK without leaking real credentials.
  //
  // Errors (network, 404, malformed body) propagate. Callers that prefer
  // graceful degradation should wrap their own try/catch.
  const client = new OpenAI({ baseURL: baseUrl, apiKey: 'sk-local' });
  const list = await client.models.list();
  return list.data.map((m) => ({ id: m.id }));
}

/**
 * Read per-model info, dispatching to the right discovery endpoint
 * based on the cached server detection. Detection is awaited internally
 * (cheap if already cached) so callers can fire this immediately after
 * provider construction.
 */
export async function getModelInfo(baseUrl: string, modelId: string): Promise<LocalModelInfo> {
  const info = await detectServer(baseUrl);
  const runtimeContextLimit = await discoverContext(info.kind, baseUrl, modelId);
  return runtimeContextLimit ? { id: modelId, runtimeContextLimit } : { id: modelId };
}
