/**
 * Unit tests for mu-webfetch. We swap `globalThis.fetch` with a scripted
 * stub so the tool runs offline and we can assert the exact request
 * sequence (Cloudflare retry, UA fallback, timeout abort, size cap, etc.).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PluginTool, ToolExecutorResult } from 'mu-core';
import { createWebFetchPlugin } from './plugin';

type FetchStub = (input: string, init?: RequestInit) => Promise<Response>;

const realFetch = globalThis.fetch;

function getTool(): PluginTool {
  const plugin = createWebFetchPlugin();
  const tool = plugin.tools?.[0];
  if (!tool) throw new Error('webfetch tool missing');
  return tool;
}

async function run(args: Record<string, unknown>, signal?: AbortSignal): Promise<string | ToolExecutorResult> {
  const tool = getTool();
  return await tool.execute(args, signal);
}

function asResult(out: string | ToolExecutorResult): ToolExecutorResult {
  return typeof out === 'string' ? { content: out, error: false } : { error: false, ...out };
}

function setFetch(stub: FetchStub) {
  (globalThis as { fetch: FetchStub }).fetch = stub;
}

beforeEach(() => {
  // Reset to a default that fails loudly so unhandled paths surface.
  setFetch(() => Promise.reject(new Error('fetch stub not set')));
});

afterEach(() => {
  (globalThis as { fetch: typeof realFetch }).fetch = realFetch;
});

describe('mu-webfetch — URL validation', () => {
  it('rejects non-http(s) URLs', async () => {
    const out = asResult(await run({ url: 'ftp://example.com' }));
    expect(out.error).toBe(true);
    expect(out.content).toContain('http://');
  });

  it('rejects missing url', async () => {
    const out = asResult(await run({}));
    expect(out.error).toBe(true);
  });
});

describe('mu-webfetch — content negotiation', () => {
  it('returns plain text bodies untouched in text mode', async () => {
    setFetch(async () => new Response('hello world', { headers: { 'content-type': 'text/plain' } }));
    const out = await run({ url: 'https://example.com/x', format: 'text' });
    expect(out).toBe('hello world');
  });

  it('returns raw HTML in html mode', async () => {
    const html = '<html><head><title>t</title></head><body><p>hi</p></body></html>';
    setFetch(async () => new Response(html, { headers: { 'content-type': 'text/html' } }));
    const out = await run({ url: 'https://example.com/x', format: 'html' });
    expect(out).toBe(html);
  });

  it('converts HTML to markdown by default', async () => {
    const html = '<html><body><h1>Title</h1><p>body <em>copy</em></p></body></html>';
    setFetch(async () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    const out = await run({ url: 'https://example.com/x' });
    expect(typeof out).toBe('string');
    const md = out as string;
    expect(md).toContain('# Title');
    expect(md).toContain('*copy*');
    expect(md).not.toContain('<h1>');
  });

  it('extracts text from HTML in text mode', async () => {
    const html = '<html><body><script>var x=1</script><p>visible</p><style>.x{}</style></body></html>';
    setFetch(async () => new Response(html, { headers: { 'content-type': 'text/html' } }));
    const out = (await run({ url: 'https://example.com/x', format: 'text' })) as string;
    expect(out).toContain('visible');
    expect(out).not.toContain('var x=1');
    expect(out).not.toContain('<p>');
  });
});

describe('mu-webfetch — image responses', () => {
  it('returns a data URL for image/png', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    setFetch(async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }));
    const out = (await run({ url: 'https://example.com/img.png' })) as string;
    expect(out).toContain('data:image/png;base64,');
    expect(out).toContain('[image: image/png, 4 bytes');
  });

  it('treats svg as text, not image', async () => {
    const svg = '<svg><title>x</title></svg>';
    setFetch(async () => new Response(svg, { headers: { 'content-type': 'image/svg+xml' } }));
    const out = await run({ url: 'https://example.com/x.svg', format: 'html' });
    expect(out).toBe(svg);
  });
});

describe('mu-webfetch — error paths', () => {
  it('returns an error result for non-2xx responses', async () => {
    setFetch(async () => new Response('boom', { status: 500, statusText: 'Server Error' }));
    const out = asResult(await run({ url: 'https://example.com/x' }));
    expect(out.error).toBe(true);
    expect(out.content).toContain('500');
  });

  it('rejects responses larger than 5MB via content-length', async () => {
    setFetch(
      async () =>
        new Response('ignored', {
          headers: { 'content-type': 'text/plain', 'content-length': String(6 * 1024 * 1024) },
        }),
    );
    const out = asResult(await run({ url: 'https://example.com/x' }));
    expect(out.error).toBe(true);
    expect(out.content).toContain('5MB');
  });

  it('rejects bodies larger than 5MB even when no content-length is sent', async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    setFetch(async () => new Response(big, { headers: { 'content-type': 'application/octet-stream' } }));
    const out = asResult(await run({ url: 'https://example.com/x' }));
    expect(out.error).toBe(true);
    expect(out.content).toContain('5MB');
  });
});

describe('mu-webfetch — Cloudflare retry', () => {
  it('retries with User-Agent: mu when first response is 403 cf-mitigated', async () => {
    const calls: { url: string; ua: string | undefined }[] = [];
    setFetch(async (url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url, ua: headers.get('user-agent') ?? undefined });
      if (calls.length === 1) {
        return new Response('blocked', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' },
        });
      }
      return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    });

    const out = await run({ url: 'https://example.com/x', format: 'text' });
    expect(out).toBe('ok');
    expect(calls.length).toBe(2);
    expect(calls[0]?.ua).toContain('Mozilla/');
    expect(calls[1]?.ua).toBe('mu');
  });

  it('does not retry on non-Cloudflare 403s', async () => {
    let n = 0;
    setFetch(async () => {
      n++;
      return new Response('forbidden', { status: 403 });
    });
    const out = asResult(await run({ url: 'https://example.com/x' }));
    expect(n).toBe(1);
    expect(out.error).toBe(true);
  });
});

describe('mu-webfetch — abort + timeout', () => {
  it('honours the host abort signal', async () => {
    setFetch((_url, init) => {
      // Hang until the caller aborts.
      return new Promise((_resolve, reject) => {
        const sig = init?.signal;
        if (sig?.aborted) {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          return;
        }
        sig?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    });

    const ac = new AbortController();
    const promise = run({ url: 'https://example.com/x', timeout: 5 }, ac.signal);
    queueMicrotask(() => ac.abort());
    const out = asResult(await promise);
    expect(out.error).toBe(true);
    expect(out.content.toLowerCase()).toContain('abort');
  });

  it('times out when the request hangs longer than the requested timeout', async () => {
    setFetch((_url, init) => {
      return new Promise((_resolve, reject) => {
        const sig = init?.signal;
        sig?.addEventListener('abort', () => {
          reject(Object.assign(new Error('timeout'), { name: 'AbortError' }));
        });
      });
    });
    const out = asResult(await run({ url: 'https://example.com/x', timeout: 0.05 }));
    expect(out.error).toBe(true);
    expect(out.content).toContain('timed out');
  });
});

describe('mu-webfetch — tool surface', () => {
  it('exposes a permission matchKey on args.url', () => {
    const tool = getTool();
    expect(tool.permission?.matchKey?.({ url: 'https://x.dev/a' })).toBe('https://x.dev/a');
    expect(tool.permission?.matchKey?.({})).toBeUndefined();
  });

  it('declares the format enum on its parameters', () => {
    const tool = getTool();
    const params = tool.definition.function.parameters as {
      properties: { format: { enum: string[] } };
    };
    expect(params.properties.format.enum).toEqual(['text', 'markdown', 'html']);
  });
});
