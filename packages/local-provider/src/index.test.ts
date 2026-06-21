import { expect, test } from 'vitest';
import type { ContentPart, Message } from 'mu-core';
import { convertMessages, convertTools, createLocalProvider } from './index';

const propsBody = (nCtx: number) =>
  JSON.stringify({ default_generation_settings: { n_ctx: nCtx }, total_slots: 1, model_path: 'p', model_alias: 'm' });

const withFetch = async (handler: (url: string) => Response | undefined, body: () => Promise<void>): Promise<void> => {
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) =>
    Promise.resolve(
      handler(String((input as Request).url ?? input)) ?? new Response('not found', { status: 404 }),
    )) as typeof fetch;
  try {
    await body();
  } finally {
    globalThis.fetch = orig;
  }
};

test('contextWindow does not cache a failed probe; retries then caches the success', async () => {
  let propsCalls = 0;
  await withFetch((url) => {
    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'm', owned_by: 'llama-swap' }] }));
    }
    if (url.includes('/props')) {
      return ++propsCalls === 1 ? new Response('boom', { status: 500 }) : new Response(propsBody(4096));
    }
    return undefined;
  }, async () => {
    const provider = createLocalProvider({ kind: 'llama-swap', baseUrl: 'http://x' });
    expect(await provider.contextWindow!('m')).toEqual(undefined);
    expect(await provider.contextWindow!('m')).toEqual(4096);
    expect(await provider.contextWindow!('m')).toEqual(4096);
    expect(propsCalls).toEqual(2);
  });
});

test('stream flushes buffered tool calls even when finish_reason is "stop"', async () => {
  class FakeClient {
    chat = {
      completions: {
        create: () =>
          Promise.resolve((async function* () {
            yield {
              choices: [{
                delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'search', arguments: '{"q":"x"}' } }] },
              }],
            };
            yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
          })()),
      },
    };
  }
  await withFetch((url) => {
    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'm', owned_by: 'llama-swap' }] }));
    }
    if (url.includes('/props')) return new Response(propsBody(8192));
    return undefined;
  }, async () => {
    const provider = createLocalProvider({ kind: 'llama-swap', baseUrl: 'http://x', openAIClient: FakeClient as any });
    const events: ContentPart[] = [];
    for await (const ev of provider.stream({ model: 'm', messages: [], tools: [] })) {
      if (ev.type === 'tool_call') events.push(ev);
    }
    expect(events).toEqual([{ type: 'tool_call', id: 'c1', name: 'search', input: { q: 'x' } }]);
  });
});

test('chat_template_kwargs: per-turn kwargs merge over (and override) the provider default', async () => {
  const captured: Record<string, unknown>[] = [];
  class FakeClient {
    chat = {
      completions: {
        create: (opts: Record<string, unknown>) => {
          captured.push(opts);
          return Promise.resolve((async function* () {
            yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
          })());
        },
      },
    };
  }
  await withFetch((url) => {
    if (url.endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'm', owned_by: 'llama-swap' }] }));
    if (url.includes('/props')) return new Response(propsBody(8192));
    return undefined;
  }, async () => {
    const provider = createLocalProvider({
      kind: 'llama-swap',
      baseUrl: 'http://x',
      model: 'm',
      chatTemplateKwargs: { enable_thinking: true, keep_me: 1 },
      openAIClient: FakeClient as any,
    });
    const drain = async (req: Parameters<typeof provider.stream>[0]) => {
      for await (const _ of provider.stream(req)) { /* drain */ }
    };
    // Main model, no per-turn override → provider-level default applies verbatim.
    await drain({ model: 'm', messages: [], tools: [] });
    expect(captured[0].chat_template_kwargs).toEqual({ enable_thinking: true, keep_me: 1 });
    // Main model + per-turn override → merged on top: per-turn key wins, provider key survives.
    await drain({ model: 'm', messages: [], tools: [], chatTemplateKwargs: { enable_thinking: false } });
    expect(captured[1].chat_template_kwargs).toEqual({ enable_thinking: false, keep_me: 1 });
    // A routed/voice model (model !== config.model) gets NO provider-level default.
    await drain({ model: 'voice', messages: [], tools: [] });
    expect(captured[2].chat_template_kwargs).toEqual(undefined);
  });
});

test('convertMessages: tool_result becomes a tool role message', () => {
  const messages: Message[] = [
    { role: 'user', content: [{ type: 'tool_result', id: 'c1', content: [{ type: 'text', text: 'ok' }] }] },
  ];
  expect(convertMessages(messages)).toEqual([{ role: 'tool', tool_call_id: 'c1', content: 'ok' }]);
});

test('convertMessages: assistant with tool_call', () => {
  const messages: Message[] = [
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'je cherche' },
        { type: 'tool_call', id: 'c1', name: 'search', input: { q: 'mu' } },
      ],
    },
  ];
  expect(convertMessages(messages)).toEqual([
    {
      role: 'assistant',
      content: 'je cherche',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"q":"mu"}' } }],
    },
  ]);
});

test('convertMessages: user multimodal text + image', () => {
  const messages: Message[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: 'quoi ?' }, {
        type: 'image',
        mime: 'image/png',
        data: new Uint8Array([0, 1, 2]),
      }],
    },
  ];
  const out = convertMessages(messages);
  expect(out).toEqual([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'quoi ?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAEC' } },
      ],
    },
  ]);
});

test('convertMessages: user with text only stays a string', () => {
  const messages: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'salut' }] }];
  expect(convertMessages(messages)).toEqual([{ role: 'user', content: 'salut' }]);
});

test('convertTools: Tool -> OpenAI function', () => {
  expect(
    convertTools([{ name: 'search', description: 'cherche', parameters: { type: 'object' }, run: async () => [] }]),
  ).toEqual(
    [{ type: 'function', function: { name: 'search', description: 'cherche', parameters: { type: 'object' } } }],
  );
});
