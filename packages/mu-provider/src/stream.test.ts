/**
 * Tests for the SSE stream parser. We don't go over the network — instead we
 * stub `globalThis.fetch` with a `Response` whose body is an in-memory
 * `ReadableStream` of recorded chunks. That exercises the real SSE parser,
 * tool-call accumulator, finish_reason handling, and usage reporting.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { streamChat } from './stream';
import type { ProviderConfig, StreamChunk, Usage } from './types';

const baseConfig: ProviderConfig = {
  baseUrl: 'http://test.invalid/v1',
  maxTokens: 1024,
  temperature: 0.7,
  streamTimeoutMs: 5_000,
};

function sseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(encoder.encode(`data: ${ev}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

function stubFetch(body: ReadableStream<Uint8Array>, status = 200): void {
  globalThis.fetch = (async () =>
    new Response(body, {
      status,
      headers: { 'content-type': 'text/event-stream' },
    })) as typeof fetch;
}

async function collect(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // Save in case a previous test mutated it.
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('streamChat content & reasoning', () => {
  it('yields content chunks in order', async () => {
    stubFetch(
      sseStream([
        JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'lo' } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      ]),
    );
    const chunks = await collect(streamChat([{ role: 'user', content: 'hi' }], baseConfig, 'm'));
    expect(chunks).toEqual([
      { type: 'content', text: 'Hel' },
      { type: 'content', text: 'lo' },
    ]);
  });

  it('yields reasoning from either reasoning or reasoning_content keys', async () => {
    stubFetch(
      sseStream([
        JSON.stringify({ choices: [{ delta: { reasoning_content: 'think ' } }] }),
        JSON.stringify({ choices: [{ delta: { reasoning: 'more' } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      ]),
    );
    const chunks = await collect(streamChat([{ role: 'user', content: '' }], baseConfig, 'm'));
    expect(chunks).toEqual([
      { type: 'reasoning', text: 'think ' },
      { type: 'reasoning', text: 'more' },
    ]);
  });
});

describe('streamChat tool calls', () => {
  it('accumulates fragmented tool-call name/arguments and emits once on finish_reason', async () => {
    stubFetch(
      sseStream([
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'do_' } }] } }],
        }),
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'thing' } }] } }],
        }),
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"x":' } }] } }],
        }),
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] } }],
        }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      ]),
    );

    const chunks = await collect(streamChat([{ role: 'user', content: 'x' }], baseConfig, 'm'));
    const toolCalls = chunks.filter((c) => c.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toEqual({
      type: 'tool_call',
      toolCall: { id: 'call_1', function: { name: 'do_thing', arguments: '{"x":1}' } },
    });
  });

  it('does not double-emit when finish_reason repeats in a trailing usage chunk', async () => {
    // Some providers emit a second SSE event with finish_reason="stop" plus
    // only `usage`. Without the `toolCallsEmitted` guard this would yield
    // the same tool call twice.
    stubFetch(
      sseStream([
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: 'call_1', function: { name: 'foo', arguments: '{}' } }],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        }),
      ]),
    );

    const chunks = await collect(streamChat([{ role: 'user', content: '' }], baseConfig, 'm'));
    const toolCalls = chunks.filter((c) => c.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
  });

  it('falls back to emitting accumulated tool calls when no finish_reason fires', async () => {
    stubFetch(
      sseStream([
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: 'call_1', function: { name: 'foo', arguments: '{}' } }],
              },
            },
          ],
        }),
      ]),
    );

    const chunks = await collect(streamChat([{ role: 'user', content: '' }], baseConfig, 'm'));
    const toolCalls = chunks.filter((c) => c.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
  });

  it('drops tool-call accumulators that never received an id+name', async () => {
    stubFetch(
      sseStream([
        // Fragment with no id — should be filtered out by getCompletedToolCalls.
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } }],
        }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      ]),
    );
    const chunks = await collect(streamChat([{ role: 'user', content: '' }], baseConfig, 'm'));
    expect(chunks.filter((c) => c.type === 'tool_call')).toHaveLength(0);
  });
});

describe('streamChat usage reporting', () => {
  it('invokes onUsage exactly once with totals from the trailing usage chunk', async () => {
    stubFetch(
      sseStream([
        JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }),
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
        }),
      ]),
    );
    const seen: Usage[] = [];
    await collect(
      streamChat([{ role: 'user', content: 'x' }], baseConfig, 'm', {
        onUsage: (u) => seen.push(u),
      }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ promptTokens: 12, completionTokens: 3, totalTokens: 15 });
  });
});

describe('streamChat error handling', () => {
  it('throws with the API error body when status is non-2xx', async () => {
    const enc = new TextEncoder();
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(enc.encode('rate limited'));
            c.close();
          },
        }),
        { status: 429 },
      )) as typeof fetch;

    await expect(collect(streamChat([{ role: 'user', content: 'x' }], baseConfig, 'm'))).rejects.toThrow(
      /API error 429.*rate limited/,
    );
  });
});
