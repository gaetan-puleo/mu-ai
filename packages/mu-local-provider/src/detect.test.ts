/**
 * Detection probe matrix tests.
 *
 * We stub `globalThis.fetch` so each test fully controls which probe paths
 * respond with what. Detection is per-baseUrl cached, so each test uses a
 * unique URL to avoid bleeding between cases (no need to thread cache-
 * resetting through the suite).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { clearDetectionCache, detectServer, originRoot } from './detect';

const originalFetch = globalThis.fetch;

function stubRoutes(routes: Record<string, { status: number; body?: unknown }>): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url).pathname;
    const entry = routes[path];
    if (!entry) return new Response('not found', { status: 404 });
    if (entry.body === undefined) return new Response(null, { status: entry.status });
    return new Response(JSON.stringify(entry.body), {
      status: entry.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  clearDetectionCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearDetectionCache();
});

describe('originRoot', () => {
  it('strips trailing /v1', () => {
    expect(originRoot('http://x:8080/v1')).toBe('http://x:8080');
    expect(originRoot('http://x:8080/v1/')).toBe('http://x:8080');
  });
  it('strips trailing slash on non-/v1 URLs', () => {
    expect(originRoot('http://x:8080/')).toBe('http://x:8080');
  });
  it('leaves a clean root alone', () => {
    expect(originRoot('http://x:8080')).toBe('http://x:8080');
  });
});

describe('detectServer', () => {
  it('detects llama-swap when /running returns a {running:[...]} object', async () => {
    stubRoutes({
      '/running': { status: 200, body: { running: [{ model: 'foo', proxy: 'http://localhost:10000' }] } },
    });
    const info = await detectServer('http://a:8080/v1');
    expect(info.kind).toBe('llama-swap');
    expect(info.label).toBe('llama-swap');
    expect(info.baseUrl).toBe('http://a:8080/v1');
  });

  it('detects llama-cpp when /props returns default_generation_settings', async () => {
    stubRoutes({
      '/props': { status: 200, body: { default_generation_settings: { params: { n_ctx: 4096 } } } },
    });
    const info = await detectServer('http://b:8080/v1');
    expect(info.kind).toBe('llama-cpp');
    expect(info.label).toBe('llama.cpp');
  });

  it('returns unknown when both probes fail', async () => {
    stubRoutes({});
    const info = await detectServer('http://c:8080/v1');
    expect(info.kind).toBe('unknown');
    expect(info.label).toBe('');
  });

  it('llama-swap wins when both probes respond (root /running takes priority)', async () => {
    // A confused setup where /props also returns 200 — llama-swap should
    // still be picked because its discriminator is more specific
    // (multi-model proxy semantics).
    stubRoutes({
      '/running': { status: 200, body: { running: [] } },
      '/props': { status: 200, body: { default_generation_settings: {} } },
    });
    const info = await detectServer('http://d:8080/v1');
    expect(info.kind).toBe('llama-swap');
  });

  it('caches per-baseUrl (second call does not re-probe)', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ running: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const a = await detectServer('http://cached:8080/v1');
    const b = await detectServer('http://cached:8080/v1');
    expect(a).toBe(b); // same promise resolution → same object
    // Two probes per call (parallel), so a cache hit means total calls stays at 2.
    expect(calls).toBe(2);
  });

  it('treats non-2xx /running and /props as miss', async () => {
    stubRoutes({
      '/running': { status: 500, body: { running: [] } },
      '/props': { status: 404 },
    });
    const info = await detectServer('http://e:8080/v1');
    expect(info.kind).toBe('unknown');
  });

  it('treats malformed JSON as miss', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (new URL(url).pathname === '/running') {
        return new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const info = await detectServer('http://f:8080/v1');
    expect(info.kind).toBe('unknown');
  });

  it('rejects /running bodies that lack a `running` array', async () => {
    stubRoutes({ '/running': { status: 200, body: { something_else: 1 } } });
    const info = await detectServer('http://g:8080/v1');
    expect(info.kind).toBe('unknown');
  });
});
