import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Tool } from 'mu-core';
import TurndownService from 'turndown';
import { createWebFetchTool } from './plugin';

type FetchStub = (input: string, init?: RequestInit) => Promise<Response>;

const realFetch = globalThis.fetch;

function getTool(): Tool {
  return createWebFetchTool();
}

async function run(args: Record<string, unknown>): Promise<string> {
  const tool = getTool();
  const parts = await tool.run(args, {});
  return parts.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

function setFetch(stub: FetchStub) {
  (globalThis as { fetch: FetchStub }).fetch = stub;
}

beforeEach(() => {
  setFetch(() => Promise.reject(new Error('fetch stub not set')));
});

afterEach(() => {
  (globalThis as { fetch: typeof realFetch }).fetch = realFetch;
});

describe('mu-webfetch — URL validation', () => {
  it('rejects non-http(s) URLs', async () => {
    const out = await run({ url: 'ftp://example.com' });
    expect(out).toContain('http://');
  });

  it('rejects a missing url', async () => {
    const out = await run({});
    expect(out).toContain('Error:');
  });
});

describe('mu-webfetch — content negotiation', () => {
  it('returns plain text bodies intact', async () => {
    setFetch(async () => new Response('hello world', { headers: { 'content-type': 'text/plain' } }));
    const out = await run({ url: 'https://example.com/x' });
    expect(out).toBe('hello world');
  });

  it('converts HTML to markdown', async () => {
    const html = '<html><body><h1>Title</h1><p>body <em>copy</em></p></body></html>';
    setFetch(async () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    const out = await run({ url: 'https://example.com/x' });
    expect(out).toContain('# Title');
    expect(out).toContain('*copy*');
    expect(out).not.toContain('<h1>');
  });

  it('strips script and style content when converting HTML', async () => {
    const html = '<html><body><script>var x=1</script><p>visible</p><style>.x{}</style></body></html>';
    setFetch(async () => new Response(html, { headers: { 'content-type': 'text/html' } }));
    const out = await run({ url: 'https://example.com/x' });
    expect(out).toContain('visible');
    expect(out).not.toContain('var x=1');
    expect(out).not.toContain('<p>');
  });
});

describe('mu-webfetch — image responses', () => {
  it('returns a data URL for image/png', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    setFetch(async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }));
    const out = await run({ url: 'https://example.com/img.png' });
    expect(out).toContain('data:image/png;base64,');
    expect(out).toContain('[image: image/png, 4 bytes');
  });

  it('treats svg as text, not as an image', async () => {
    const svg = '<svg><title>x</title></svg>';
    setFetch(async () => new Response(svg, { headers: { 'content-type': 'image/svg+xml' } }));
    const out = await run({ url: 'https://example.com/x.svg' });
    expect(out).toBe(svg);
  });
});

describe('mu-webfetch — error paths', () => {
  it('returns an error result for non-2xx responses', async () => {
    setFetch(async () => new Response('boom', { status: 500, statusText: 'Server Error' }));
    const out = await run({ url: 'https://example.com/x' });
    expect(out).toContain('500');
  });

  it('rejects responses exceeding 5MB via content-length', async () => {
    setFetch(
      async () =>
        new Response('ignored', {
          headers: { 'content-type': 'text/plain', 'content-length': String(6 * 1024 * 1024) },
        }),
    );
    const out = await run({ url: 'https://example.com/x' });
    expect(out).toContain('5MB');
  });

  it('rejects bodies exceeding 5MB even when no content-length is sent', async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    setFetch(async () => new Response(big, { headers: { 'content-type': 'application/octet-stream' } }));
    const out = await run({ url: 'https://example.com/x' });
    expect(out).toContain('5MB');
  });
});

describe('mu-webfetch — Cloudflare retry', () => {
  it('retries with User-Agent: mu when the first response is a 403 cf-mitigated', async () => {
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

    const out = await run({ url: 'https://example.com/x' });
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
    const out = await run({ url: 'https://example.com/x' });
    expect(n).toBe(1);
    expect(out).toContain('Error:');
  });
});

describe('mu-webfetch — abort + timeout', () => {
  it('times out when the request stays blocked longer than the requested timeout', async () => {
    setFetch((_url, init) => {
      return new Promise((_resolve, reject) => {
        const sig = init?.signal;
        sig?.addEventListener('abort', () => {
          reject(Object.assign(new Error('timeout'), { name: 'AbortError' }));
        });
      });
    });
    const out = await run({ url: 'https://example.com/x', timeout: 0.1 });
    expect(out).toContain('timed out');
  });

  it('rejects timeout values below the minimum threshold outright', async () => {
    setFetch(() => Promise.reject(new Error('fetch should not run')));
    const out = await run({ url: 'https://example.com/x', timeout: 0 });
    expect(out).toContain('Error:');
    expect(out).toContain('timeout');
  });
});

describe('mu-webfetch — charset detection (#216)', () => {
  it('decodes windows-1252 from the Content-Type header', async () => {
    const bytes = new Uint8Array([0x91, 0x68, 0x69, 0x92]);
    setFetch(async () => new Response(bytes, { headers: { 'content-type': 'text/plain; charset=windows-1252' } }));
    const out = await run({ url: 'https://example.com/x' });
    expect(out).toContain('‘hi’');
    expect(out).not.toContain('�');
  });

  it('decodes shift_jis from the Content-Type header', async () => {
    const bytes = new Uint8Array([0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd]);
    setFetch(async () => new Response(bytes, { headers: { 'content-type': 'text/plain; charset=shift_jis' } }));
    const out = await run({ url: 'https://example.com/x' });
    expect(out).toBe('こんにちは');
  });

  it('falls back to <meta charset> when the header does not specify a charset', async () => {
    const head = new TextEncoder().encode(
      '<html><head><meta charset="windows-1252"></head><body><p>',
    );
    const payload = new Uint8Array([0xd1, 0x6f, 0xf1, 0x6f]);
    const tail = new TextEncoder().encode('</p></body></html>');
    const bytes = new Uint8Array(head.length + payload.length + tail.length);
    bytes.set(head, 0);
    bytes.set(payload, head.length);
    bytes.set(tail, head.length + payload.length);
    setFetch(async () => new Response(bytes, { headers: { 'content-type': 'text/html' } }));
    const out = await run({ url: 'https://example.com/x' });
    expect(out).toContain('Ñoño');
    expect(out).not.toContain('�');
  });

  it('falls back to <meta http-equiv="Content-Type"> when the header does not specify a charset', async () => {
    const head = new TextEncoder().encode(
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"></head><body><p>',
    );
    const payload = new Uint8Array([0xe9]);
    const tail = new TextEncoder().encode('</p></body></html>');
    const bytes = new Uint8Array(head.length + payload.length + tail.length);
    bytes.set(head, 0);
    bytes.set(payload, head.length);
    bytes.set(tail, head.length + payload.length);
    setFetch(async () => new Response(bytes, { headers: { 'content-type': 'text/html' } }));
    const out = await run({ url: 'https://example.com/x' });
    expect(out).toContain('é');
    expect(out).not.toContain('�');
  });

  it('falls back to UTF-8 when the charset label is unknown', async () => {
    const bytes = new TextEncoder().encode('hello UTF-8');
    setFetch(async () =>
      new Response(bytes, { headers: { 'content-type': 'text/plain; charset=bogus-encoding-xyz' } })
    );
    const out = await run({ url: 'https://example.com/x' });
    expect(out).toBe('hello UTF-8');
  });

  it('defaults to UTF-8 when no charset is declared anywhere', async () => {
    const bytes = new Uint8Array([0x68, 0xc3, 0xa9, 0x6c, 0x6c, 0x6f]);
    setFetch(async () => new Response(bytes, { headers: { 'content-type': 'text/plain' } }));
    const out = await run({ url: 'https://example.com/x' });
    expect(out).toBe('héllo');
  });
});

describe('mu-webfetch — turndown failure (#217)', () => {
  let originalTurndown: typeof TurndownService.prototype.turndown;

  beforeEach(() => {
    originalTurndown = TurndownService.prototype.turndown;
    TurndownService.prototype.turndown = function () {
      throw new Error('boom from turndown');
    };
  });

  afterEach(() => {
    TurndownService.prototype.turndown = originalTurndown;
  });

  it('returns an error string instead of throwing when turndown fails', async () => {
    const html = '<html><body><p>doomed</p></body></html>';
    setFetch(async () => new Response(html, { headers: { 'content-type': 'text/html' } }));
    const out = await run({ url: 'https://example.com/x' });
    expect(out).toContain('Error:');
    expect(out).toContain('failed to convert HTML to markdown');
    expect(out).toContain('boom from turndown');
  });
});

describe('mu-webfetch — tool surface', () => {
  it('declares its usage guidance in the description', () => {
    const tool = getTool();
    expect(tool.description).toContain('large images bloat context');
  });
});

describe('mu-webfetch — SSRF protection (#213)', () => {
  it('rejects http://127.0.0.1 without contacting fetch', async () => {
    setFetch(() => Promise.reject(new Error('fetch should not run')));
    const out = await run({ url: 'http://127.0.0.1/foo' });
    expect(out).toContain('Error:');
    expect(out).toContain('internal');
  });

  it('rejects the cloud metadata endpoint 169.254.169.254', async () => {
    setFetch(() => Promise.reject(new Error('fetch should not run')));
    const out = await run({ url: 'http://169.254.169.254/latest/meta-data/' });
    expect(out).toContain('Error:');
    expect(out).toContain('internal');
  });

  it('rejects http://localhost/', async () => {
    setFetch(() => Promise.reject(new Error('fetch should not run')));
    const out = await run({ url: 'http://localhost/' });
    expect(out).toContain('Error:');
    expect(out).toContain('internal');
  });

  it('rejects http://10.0.0.5/ (RFC1918)', async () => {
    setFetch(() => Promise.reject(new Error('fetch should not run')));
    const out = await run({ url: 'http://10.0.0.5/' });
    expect(out).toContain('Error:');
    expect(out).toContain('internal');
  });

  it('rejects the IPv6 loopback http://[::1]/', async () => {
    setFetch(() => Promise.reject(new Error('fetch should not run')));
    const out = await run({ url: 'http://[::1]/' });
    expect(out).toContain('Error:');
    expect(out).toContain('internal');
  });

  it('rejects the IPv4-mapped IPv6 http://[::ffff:127.0.0.1]/', async () => {
    setFetch(() => Promise.reject(new Error('fetch should not run')));
    const out = await run({ url: 'http://[::ffff:127.0.0.1]/' });
    expect(out).toContain('Error:');
    expect(out).toContain('internal');
  });

  it('lets a public HTTPS URL pass validation (mocked fetch)', async () => {
    setFetch(async () => new Response('ok', { headers: { 'content-type': 'text/plain' } }));
    const out = await run({ url: 'https://example.com/x' });
    expect(out).toBe('ok');
  });

  it('rejects when a public URL redirects to 127.0.0.1', async () => {
    let n = 0;
    setFetch(async () => {
      n++;
      if (n === 1) {
        return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
      }
      throw new Error('should not follow into internal host');
    });
    const out = await run({ url: 'https://example.com/x' });
    expect(out).toContain('Error:');
    expect(out).toContain('internal');
    expect(n).toBe(1);
  });

  it('limits redirect chains to MAX_REDIRECTS', async () => {
    let n = 0;
    setFetch(async (_url) => {
      n++;
      return new Response(null, { status: 302, headers: { location: `https://example.com/r${n}` } });
    });
    const out = await run({ url: 'https://example.com/start' });
    expect(out).toContain('Error:');
    expect(out).toContain('Too many redirects');
  });
});
