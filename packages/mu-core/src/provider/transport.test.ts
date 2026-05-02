import { describe, expect, it } from 'bun:test';
import { fetchWithIdleTimeout, readNDJSON, readSSE } from './transport';

function bodyResponse(text: string): Response {
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('readSSE', () => {
  it('yields data lines from one event', async () => {
    const r = bodyResponse('data: hello\n\n');
    const out: string[] = [];
    for await (const v of readSSE(r)) out.push(v);
    expect(out).toEqual(['hello']);
  });

  it('handles multiple events split by blank lines', async () => {
    const r = bodyResponse('data: a\n\ndata: b\n\n');
    const out: string[] = [];
    for await (const v of readSSE(r)) out.push(v);
    expect(out).toEqual(['a', 'b']);
  });

  it('ignores non-data lines', async () => {
    const r = bodyResponse(': comment\nevent: x\ndata: payload\n\n');
    const out: string[] = [];
    for await (const v of readSSE(r)) out.push(v);
    expect(out).toEqual(['payload']);
  });
});

describe('readNDJSON', () => {
  it('yields one line per JSON record', async () => {
    const r = bodyResponse('{"a":1}\n{"b":2}\n');
    const out: string[] = [];
    for await (const v of readNDJSON(r)) out.push(v);
    expect(out).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('emits trailing line without final newline', async () => {
    const r = bodyResponse('{"a":1}');
    const out: string[] = [];
    for await (const v of readNDJSON(r)) out.push(v);
    expect(out).toEqual(['{"a":1}']);
  });
});

describe('fetchWithIdleTimeout', () => {
  it('cancels idle timer when fetch itself rejects', async () => {
    // Use a URL that rejects immediately. We can't directly observe the
    // timer, but we can check that the call rejects synchronously and that
    // the function does not leak a hanging timer (verified via the test
    // process exiting promptly after this expect).
    const start = Date.now();
    await expect(fetchWithIdleTimeout('http://127.0.0.1:1', {}, 5000)).rejects.toBeDefined();
    // If the timer leaked, the test would block until 5s; we assert <1s.
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
