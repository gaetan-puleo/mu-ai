/**
 * Server-kind detection for mu-local-provider.
 *
 * Probes a small fixed set of endpoints in parallel and infers which local
 * server is behind the given OpenAI-compatible `baseUrl`. Results are
 * cached per-baseUrl for the lifetime of the process — the kind of the
 * server behind a URL doesn't change in practice.
 *
 * v1 supports two kinds:
 *
 *   - `llama-swap` — multi-model proxy. Probe: `GET /running` returns a
 *     JSON object with a `running` array of loaded models.
 *   - `llama-cpp`  — standalone `llama-server`. Probe: `GET /props` returns
 *     `default_generation_settings` (a sampling/runtime config blob).
 *
 * Anything else falls through to `unknown` — streaming still works (it's
 * OpenAI-compatible by assumption) but per-kind discovery (context window
 * via `models.ts`) is unavailable.
 *
 * Detection is best-effort: short timeout (1.5s), failures are silent, and
 * the result is cached so we never re-probe. Hosts that want to force a
 * refresh can call `clearDetectionCache()`.
 */

const PROBE_TIMEOUT_MS = 1500;

export type LocalServerKind = 'llama-swap' | 'llama-cpp' | 'unknown';

export interface LocalServerInfo {
  /** Stable identifier for the detected server kind. */
  kind: LocalServerKind;
  /** Human-readable label used in UI surfaces. Empty string when unknown. */
  label: string;
  /** Echoed back so consumers always know which baseUrl this result describes. */
  baseUrl: string;
}

/**
 * Strip a trailing `/v1` (with optional slash) from the OpenAI base URL.
 * Detection endpoints live at the server root, not under `/v1/*`.
 */
export function originRoot(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * llama-swap exposes `GET /running` with a JSON body of shape
 * `{running: [{cmd, model, proxy, state, …}, ...]}`. The object MUST
 * carry a `running` array — that's how we discriminate from llama.cpp
 * (which 404s this path) or any other server that might happen to
 * return 200 with a different shape.
 */
async function probeLlamaSwap(root: string): Promise<boolean> {
  const res = await fetchWithTimeout(`${root}/running`, PROBE_TIMEOUT_MS);
  if (!res || !res.ok) return false;
  try {
    const body = (await res.json()) as unknown;
    return (
      !!body &&
      typeof body === 'object' &&
      Array.isArray((body as { running?: unknown }).running)
    );
  } catch {
    return false;
  }
}

/**
 * Standalone llama-server exposes `GET /props` with a JSON body that
 * always contains `default_generation_settings`. llama-swap *also*
 * proxies a `/props` under `/upstream/<model>/`, but NOT at the root —
 * so this probe is sufficient to discriminate.
 */
async function probeLlamaCpp(root: string): Promise<boolean> {
  const res = await fetchWithTimeout(`${root}/props`, PROBE_TIMEOUT_MS);
  if (!res || !res.ok) return false;
  try {
    const body = (await res.json()) as unknown;
    return (
      !!body &&
      typeof body === 'object' &&
      'default_generation_settings' in (body as Record<string, unknown>)
    );
  } catch {
    return false;
  }
}

function labelFor(kind: LocalServerKind): string {
  switch (kind) {
    case 'llama-swap':
      return 'llama-swap';
    case 'llama-cpp':
      return 'llama.cpp';
    default:
      return '';
  }
}

const cache = new Map<string, Promise<LocalServerInfo>>();

/**
 * Detect (or return the cached detection of) the local server kind behind
 * `baseUrl`. Probes run in parallel — both fire even if one returns first,
 * to keep the implementation simple. Whichever positive match arrives
 * wins, with llama-swap taking priority on simultaneous truthy results
 * (it's strictly the "more specific" server: a llama-swap install also
 * responds to llama.cpp-style endpoints on its upstream subpaths, but
 * never at the root).
 */
export function detectServer(baseUrl: string): Promise<LocalServerInfo> {
  const cached = cache.get(baseUrl);
  if (cached) return cached;

  const root = originRoot(baseUrl);
  const promise = (async (): Promise<LocalServerInfo> => {
    const [isLlamaSwap, isLlamaCpp] = await Promise.all([probeLlamaSwap(root), probeLlamaCpp(root)]);
    const kind: LocalServerKind = isLlamaSwap ? 'llama-swap' : isLlamaCpp ? 'llama-cpp' : 'unknown';
    return { kind, label: labelFor(kind), baseUrl };
  })();
  cache.set(baseUrl, promise);
  return promise;
}

/** Drop the cached detection for `baseUrl`, or for every entry when omitted. */
export function clearDetectionCache(baseUrl?: string): void {
  if (baseUrl === undefined) {
    cache.clear();
    return;
  }
  cache.delete(baseUrl);
}
