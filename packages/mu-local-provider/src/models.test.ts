import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { clearDetectionCache } from './detect';
import { getModelInfo } from './models';

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

describe('getModelInfo — llama-swap', () => {
  it('reads runtimeContextLimit from /upstream/<id>/props default_generation_settings.params.n_ctx', async () => {
    stubRoutes({
      // detection
      '/running': { status: 200, body: { running: [{ model: 'm' }] } },
      // discovery: same shape as standalone llama-server /props, fronted
      // under the per-model /upstream/<id>/ prefix.
      '/upstream/qwen-3.6-35b/props': {
        status: 200,
        body: { default_generation_settings: { params: { n_ctx: 200192 } } },
      },
    });
    const info = await getModelInfo('http://swap:8080/v1', 'qwen-3.6-35b');
    expect(info).toEqual({ id: 'qwen-3.6-35b', runtimeContextLimit: 200192 });
  });

  it('omits runtimeContextLimit when /props returns an unrelated body', async () => {
    stubRoutes({
      '/running': { status: 200, body: { running: [] } },
      '/upstream/foo/props': { status: 200, body: { other_field: 1 } },
    });
    const info = await getModelInfo('http://swap-empty:8080/v1', 'foo');
    expect(info).toEqual({ id: 'foo' });
  });

  it('omits runtimeContextLimit on /props failure (e.g. model not loaded)', async () => {
    stubRoutes({
      '/running': { status: 200, body: { running: [] } },
      '/upstream/foo/props': { status: 404 },
    });
    const info = await getModelInfo('http://swap-err:8080/v1', 'foo');
    expect(info).toEqual({ id: 'foo' });
  });

  it('url-encodes the model id segment for safety with special chars', async () => {
    stubRoutes({
      '/running': { status: 200, body: { running: [] } },
      // The id "qwen3.5-122b:fast-16" contains a ':' which must be encoded.
      [`/upstream/${encodeURIComponent('qwen3.5-122b:fast-16')}/props`]: {
        status: 200,
        body: { default_generation_settings: { params: { n_ctx: 4096 } } },
      },
    });
    const info = await getModelInfo('http://swap:8080/v1', 'qwen3.5-122b:fast-16');
    expect(info).toEqual({ id: 'qwen3.5-122b:fast-16', runtimeContextLimit: 4096 });
  });
});

describe('getModelInfo — llama-cpp', () => {
  it('reads runtimeContextLimit from /props default_generation_settings.params.n_ctx', async () => {
    stubRoutes({
      '/props': {
        status: 200,
        body: {
          default_generation_settings: { params: { n_ctx: 4096 } },
        },
      },
    });
    const info = await getModelInfo('http://cpp:8080/v1', 'any-model');
    expect(info).toEqual({ id: 'any-model', runtimeContextLimit: 4096 });
  });

  it('also accepts n_ctx directly on default_generation_settings (older builds)', async () => {
    stubRoutes({
      '/props': {
        status: 200,
        body: { default_generation_settings: { n_ctx: 8192 } },
      },
    });
    const info = await getModelInfo('http://cpp2:8080/v1', 'any-model');
    expect(info).toEqual({ id: 'any-model', runtimeContextLimit: 8192 });
  });
});

describe('getModelInfo — unknown', () => {
  it('returns just the id when no detection probe matches', async () => {
    stubRoutes({});
    const info = await getModelInfo('http://nada:8080/v1', 'm');
    expect(info).toEqual({ id: 'm' });
  });
});
