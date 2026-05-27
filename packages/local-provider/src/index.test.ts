import { expect, fn } from '@std/expect';
import { afterEach, describe, it } from '@std/testing/bdd';
import {
  collectLlamaSwapContext,
  getLlamaSwapOpenAIBaseUrl,
  normalizeLlamaSwapBaseUrl,
  prepareLlamaSwapChatRequest,
  tokenizeLlamaSwap,
} from './llama-swap';
import type { LLMProvider } from 'mu-core';
import {
  createLocalProviderPlugin,
  detectLocalBackend,
  listLocalModels,
} from './index';
import type { LocalProviderConfig } from './index';

let currentChatImpl: ((options: unknown) => unknown) | undefined;
const mockCreateChatCompletion = fn((options: unknown) => currentChatImpl?.(options));

class MockOpenAI {
  chat = {
    completions: {
      create: mockCreateChatCompletion,
    },
  };
}

const createLocalProvider = (config: LocalProviderConfig): LLMProvider =>
  createLocalProviderPlugin({ openAIClient: MockOpenAI as never, ...config }).provider!;

const MOCK_MODELS_RESPONSE = {
  data: [
    { id: 'gemma-4-e2b', owned_by: 'llama-swap' },
    { id: 'qwen-3.6-27b', owned_by: 'llama-swap' },
  ],
};

const MOCK_SLOTS_RESPONSE = [
  {
    id: 0,
    n_ctx: 32000,
    is_processing: false,
    id_task: undefined,
    next_token: [{ has_next_token: false, has_new_line: false, n_remain: 32000, n_decoded: 0 }],
  },
  {
    id: 1,
    n_ctx: 32000,
    is_processing: true,
    id_task: 42,
    next_token: [{ has_next_token: true, has_new_line: false, n_remain: 1000, n_decoded: 500 }],
  },
];

const MOCK_PROPS_RESPONSE = {
  default_generation_settings: { n_ctx: 32000 },
  total_slots: 4,
  model_path: '/models/gemma.gguf',
  model_alias: 'gemma-4-e2b',
};

function mockFetch(responses: Record<string, { ok: boolean; json: () => unknown }>) {
  const originalFetch = globalThis.fetch;
  const stub = fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const urlString = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    for (const [path, response] of Object.entries(responses)) {
      if (urlString.includes(path)) {
        return {
          ok: response.ok,
          json: response.json,
          status: response.ok ? 200 : 500,
          text: async () => (response.ok ? '' : 'error'),
        } as Response;
      }
    }
    return { ok: false, status: 404, text: async () => 'not found' } as Response;
  }) as typeof globalThis.fetch;
  globalThis.fetch = stub;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe('normalizeLlamaSwapBaseUrl', () => {
  it('removes trailing slash', () => {
    expect(normalizeLlamaSwapBaseUrl('http://localhost:8080/')).toBe('http://localhost:8080');
  });

  it('removes /v1 suffix', () => {
    expect(normalizeLlamaSwapBaseUrl('http://localhost:8080/v1')).toBe('http://localhost:8080');
  });

  it('keeps root url unchanged', () => {
    expect(normalizeLlamaSwapBaseUrl('http://localhost:8080')).toBe('http://localhost:8080');
  });
});

describe('getLlamaSwapOpenAIBaseUrl', () => {
  it('appends /v1 to root url', () => {
    expect(getLlamaSwapOpenAIBaseUrl('http://localhost:8080')).toBe('http://localhost:8080/v1');
  });

  it('normalizes then appends /v1', () => {
    expect(getLlamaSwapOpenAIBaseUrl('http://localhost:8080/')).toBe('http://localhost:8080/v1');
  });
});

describe('prepareLlamaSwapChatRequest', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
  });

  it('returns id_slot and cache_prompt when slots available', async () => {
    cleanup = mockFetch({
      '/slots': { ok: true, json: () => MOCK_SLOTS_RESPONSE },
    });

    const extras = await prepareLlamaSwapChatRequest({
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
    });

    expect(extras).toEqual({
      id_slot: 0,
      cache_prompt: true,
    });
  });

  it('returns undefined when all slots are processing', async () => {
    const allBusy = MOCK_SLOTS_RESPONSE.map((s) => ({ ...s, is_processing: true }));
    cleanup = mockFetch({
      '/slots': { ok: true, json: () => allBusy },
    });

    const extras = await prepareLlamaSwapChatRequest({
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
    });

    expect(extras).toBeUndefined();
  });

  it('returns undefined when slots fetch fails', async () => {
    cleanup = mockFetch({
      '/slots': { ok: false, json: () => ({}) },
    });

    const extras = await prepareLlamaSwapChatRequest({
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
    });

    expect(extras).toBeUndefined();
  });
});

describe('collectLlamaSwapContext', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
  });

  it('collects props and slots with currentSlot when selectedSlotId provided', async () => {
    cleanup = mockFetch({
      '/props': { ok: true, json: () => MOCK_PROPS_RESPONSE },
      '/slots': { ok: true, json: () => MOCK_SLOTS_RESPONSE },
    });

    const context = await collectLlamaSwapContext({
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
      selectedSlotId: 0,
    });

    expect(context).toBeDefined();
    expect(context?.props?.n_ctx).toBe(32000);
    expect(context?.props?.total_slots).toBe(4);
    expect(context?.slots).toHaveLength(2);
    expect(context?.currentSlot?.id).toBe(0);
  });

  it('collects slots without currentSlot when no selectedSlotId', async () => {
    cleanup = mockFetch({
      '/slots': { ok: true, json: () => MOCK_SLOTS_RESPONSE },
      '/props': { ok: false, json: () => ({}) },
    });

    const context = await collectLlamaSwapContext({
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
    });

    expect(context).toBeDefined();
    expect(context?.slots).toHaveLength(2);
    expect(context?.currentSlot).toBeUndefined();
    expect(context?.props).toBeUndefined();
  });

  it('returns undefined when both fetches fail', async () => {
    cleanup = mockFetch({
      '/slots': { ok: false, json: () => ({}) },
      '/props': { ok: false, json: () => ({}) },
    });

    const context = await collectLlamaSwapContext({
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
    });

    expect(context).toBeUndefined();
  });
});

describe('detectLocalBackend', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
  });

  it('detects llama-swap from /v1/models', async () => {
    cleanup = mockFetch({
      '/v1/models': { ok: true, json: () => MOCK_MODELS_RESPONSE },
    });

    const backend = await detectLocalBackend({
      baseUrl: 'http://localhost:8080',
    });

    expect(backend.kind).toBe('llama-swap');
    expect(backend.baseUrl).toBe('http://localhost:8080');
    expect(backend.models).toHaveLength(2);
    expect(backend.models[0].id).toBe('gemma-4-e2b');
  });

  it('throws when backend unreachable', async () => {
    cleanup = mockFetch({
      '/v1/models': { ok: false, json: () => ({}) },
    });

    await expect(detectLocalBackend({ baseUrl: 'http://localhost:8080' })).rejects.toThrow('Unsupported local backend');
  });

  it('throws when kind is specified but detection fails', async () => {
    cleanup = mockFetch({
      '/v1/models': { ok: false, json: () => ({}) },
    });

    await expect(detectLocalBackend({ kind: 'llama-swap', baseUrl: 'http://localhost:8080' })).rejects.toThrow(
      'Cannot detect llama-swap backend',
    );
  });
});

describe('listLocalModels', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
  });

  it('returns models from detected backend', async () => {
    cleanup = mockFetch({
      '/v1/models': { ok: true, json: () => MOCK_MODELS_RESPONSE },
    });

    const models = await listLocalModels({
      baseUrl: 'http://localhost:8080',
    });

    expect(models).toHaveLength(2);
    expect(models.map((m) => m.id)).toContain('gemma-4-e2b');
    expect(models.map((m) => m.id)).toContain('qwen-3.6-27b');
  });
});

describe('createLocalProvider', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    currentChatImpl = undefined;
  });

  it('throws when model is missing', async () => {
    cleanup = mockFetch({
      '/v1/models': { ok: true, json: () => MOCK_MODELS_RESPONSE },
    });

    const provider = createLocalProvider({
      baseUrl: 'http://localhost:8080',
    });

    await expect(provider([], {})).rejects.toThrow('Local provider requires a model');
    await expect(provider([], {})).rejects.toThrow('gemma-4-e2b');
    await expect(provider([], {})).rejects.toThrow('qwen-3.6-27b');
  });

  it('includes stream usage as prompt context', async () => {
    cleanup = mockFetch({
      '/v1/models': { ok: true, json: () => MOCK_MODELS_RESPONSE },
      '/slots': { ok: true, json: () => MOCK_SLOTS_RESPONSE },
      '/props': { ok: true, json: () => MOCK_PROPS_RESPONSE },
    });
    let requestOptions: Record<string, unknown> | undefined;

    currentChatImpl = (options: unknown) => {
      requestOptions = options as Record<string, unknown>;
      return (async function* () {
        yield { choices: [{ delta: { content: 'hello' } }] };
        yield { choices: [], usage: { prompt_tokens: 1234, completion_tokens: 5, total_tokens: 1239 } };
      })();
    };

    const provider = createLocalProvider({
      kind: 'llama-swap',
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
    });
    const result = await provider([], {});
    const events: unknown[] = [];

    for await (const event of result as AsyncIterable<unknown>) {
      events.push(event);
    }

    expect(requestOptions?.stream_options).toEqual({ include_usage: true });
    expect(events.at(-1)).toEqual({
      type: 'done',
      response: {
        content: 'hello',
        tool_calls: undefined,
        context: {
          usage: { promptTokens: 1234, completionTokens: 5, totalTokens: 1239 },
          props: { n_ctx: 32000, total_slots: 4, model_path: '/models/gemma.gguf', model_alias: 'gemma-4-e2b' },
          slots: [
            { id: 0, n_ctx: 32000, is_processing: false },
            { id: 1, n_ctx: 32000, is_processing: true },
          ],
          currentSlot: { id: 0, n_ctx: 32000, is_processing: false },
          contextMap: {
            model: 'gemma-4-e2b',
            usedTokens: 1234,
            windowTokens: 32000,
            estimated: false,
            parts: [],
          },
        },
      },
    });
  });

  it('emits reasoning deltas from OpenAI-compatible reasoning fields', async () => {
    cleanup = mockFetch({
      '/v1/models': { ok: true, json: () => MOCK_MODELS_RESPONSE },
      '/slots': { ok: true, json: () => MOCK_SLOTS_RESPONSE },
      '/props': { ok: true, json: () => MOCK_PROPS_RESPONSE },
    });

    currentChatImpl = () =>
      (async function* () {
        yield { choices: [{ delta: { reasoning_content: 'think ' } }] };
        yield { choices: [{ delta: { reasoning: 'more ' } }] };
        yield { choices: [{ delta: { reasoningContent: 'now' } }] };
        yield { choices: [{ delta: { content: 'answer' } }] };
      })();

    const provider = createLocalProvider({
      kind: 'llama-swap',
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
    });
    const result = await provider([], {});
    const events: unknown[] = [];

    for await (const event of result as AsyncIterable<unknown>) {
      events.push(event);
    }

    expect(events.slice(0, 4)).toEqual([
      { type: 'reasoning_delta', content: 'think ' },
      { type: 'reasoning_delta', content: 'more ' },
      { type: 'reasoning_delta', content: 'now' },
      { type: 'delta', content: 'answer' },
    ]);
  });

  it('populates parts with real token counts from /tokenize', async () => {
    cleanup = mockFetch({
      '/v1/models': { ok: true, json: () => MOCK_MODELS_RESPONSE },
      '/slots': { ok: true, json: () => MOCK_SLOTS_RESPONSE },
      '/props': { ok: true, json: () => MOCK_PROPS_RESPONSE },
      '/tokenize': { ok: true, json: () => ({ tokens: [1, 2, 3, 4, 5, 6, 7] }) },
    });

    currentChatImpl = () =>
      (async function* () {
        yield { choices: [{ delta: { content: 'hi' } }] };
        yield { choices: [], usage: { prompt_tokens: 21, completion_tokens: 1, total_tokens: 22 } };
      })();

    const provider = createLocalProvider({
      kind: 'llama-swap',
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
    });
    const result = await provider(
      [
        { role: 'system', content: 'you are helpful' },
        { role: 'user', content: 'hello' },
        { role: 'tool', content: '{"ok":true}', tool_id: 't1' },
      ],
      {},
    );

    const events: unknown[] = [];
    for await (const event of result as AsyncIterable<unknown>) events.push(event);

    const done = events.at(-1) as { response: { context: { contextMap: unknown } } };
    const contextMap = done.response.context.contextMap as {
      estimated: boolean;
      parts: Array<{ kind: string; tokens: number; estimated: boolean }>;
    };

    expect(contextMap.estimated).toBe(false);
    expect(contextMap.parts.every((p) => p.estimated === false)).toBe(true);
    expect(contextMap.parts.every((p) => p.tokens === 7)).toBe(true);
    expect(contextMap.parts.map((p) => p.kind).sort()).toEqual(['messages', 'system', 'tool_results']);
  });

  it('falls back to estimate when /tokenize returns 404', async () => {
    cleanup = mockFetch({
      '/v1/models': { ok: true, json: () => MOCK_MODELS_RESPONSE },
      '/slots': { ok: true, json: () => MOCK_SLOTS_RESPONSE },
      '/props': { ok: true, json: () => MOCK_PROPS_RESPONSE },
      '/tokenize': { ok: false, json: () => ({}) },
    });

    currentChatImpl = () =>
      (async function* () {
        yield { choices: [{ delta: { content: 'hi' } }] };
        yield { choices: [], usage: { prompt_tokens: 21, completion_tokens: 1, total_tokens: 22 } };
      })();

    const provider = createLocalProvider({
      kind: 'llama-swap',
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
    });
    const result = await provider([{ role: 'system', content: 'you are helpful' }], {});

    const events: unknown[] = [];
    for await (const event of result as AsyncIterable<unknown>) events.push(event);

    const done = events.at(-1) as { response: { context: { contextMap: unknown } } };
    const contextMap = done.response.context.contextMap as {
      estimated: boolean;
      parts: Array<{ kind: string; estimated: boolean }>;
    };

    expect(contextMap.estimated).toBe(true);
    expect(contextMap.parts[0].estimated).toBe(true);
  });

  it('retries backend detection after an initial failure', async () => {
    const cleanupFail = mockFetch({
      '/v1/models': { ok: false, json: () => ({}) },
    });

    const provider = createLocalProvider({
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
    });

    await expect(provider([], {})).rejects.toThrow('Unsupported local backend');
    cleanupFail();

    cleanup = mockFetch({
      '/v1/models': { ok: true, json: () => MOCK_MODELS_RESPONSE },
      '/slots': { ok: true, json: () => MOCK_SLOTS_RESPONSE },
      '/props': { ok: true, json: () => MOCK_PROPS_RESPONSE },
    });

    currentChatImpl = () =>
      (async function* () {
        yield { choices: [{ delta: { content: 'ok' } }] };
      })();

    const result = await provider([], {});
    const events: unknown[] = [];
    for await (const event of result as AsyncIterable<unknown>) events.push(event);
    const done = events.at(-1) as { type: string; response: { content: string } };
    expect(done.type).toBe('done');
    expect(done.response.content).toBe('ok');
  });

  it('keeps concurrent tool-call deltas separate when no index is provided', async () => {
    cleanup = mockFetch({
      '/v1/models': { ok: true, json: () => MOCK_MODELS_RESPONSE },
      '/slots': { ok: true, json: () => MOCK_SLOTS_RESPONSE },
      '/props': { ok: true, json: () => MOCK_PROPS_RESPONSE },
    });

    currentChatImpl = () =>
      (async function* () {
        yield {
          choices: [{
            delta: {
              tool_calls: [
                { id: 'call_a', function: { name: 'foo', arguments: '{"x":1}' } },
                { id: 'call_b', function: { name: 'bar', arguments: '{"y":2}' } },
              ],
            },
          }],
        };
        yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
      })();

    const provider = createLocalProvider({
      kind: 'llama-swap',
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
    });
    type ToolCallEvent = { type: string; id: string; tool: string; args: string };
    const result = await provider([], {});
    const events: Array<{ type: string; call?: ToolCallEvent }> = [];
    for await (const event of result as AsyncIterable<{ type: string; call?: ToolCallEvent }>) {
      events.push(event);
    }

    const toolEvents = events.filter((e) => e.type === 'tool_call').map((e) => e.call);
    expect(toolEvents).toHaveLength(2);
    expect(toolEvents).toEqual([
      { type: 'tool_call', id: 'call_a', tool: 'foo', args: '{"x":1}' },
      { type: 'tool_call', id: 'call_b', tool: 'bar', args: '{"y":2}' },
    ]);
  });

  it('discards partial tool-call buffer when finish_reason is stop', async () => {
    cleanup = mockFetch({
      '/v1/models': { ok: true, json: () => MOCK_MODELS_RESPONSE },
      '/slots': { ok: true, json: () => MOCK_SLOTS_RESPONSE },
      '/props': { ok: true, json: () => MOCK_PROPS_RESPONSE },
    });

    currentChatImpl = () =>
      (async function* () {
        yield {
          choices: [{
            delta: {
              tool_calls: [{ index: 0, id: 'partial', function: { name: 'foo', arguments: '{"x":' } }],
            },
          }],
        };
        yield { choices: [{ delta: { content: 'sorry' }, finish_reason: 'stop' }] };
      })();

    const provider = createLocalProvider({
      kind: 'llama-swap',
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
    });
    const result = await provider([], {});
    const events: Array<{ type: string; response?: { tool_calls?: unknown } }> = [];
    for await (const event of result as AsyncIterable<{ type: string; response?: { tool_calls?: unknown } }>) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'tool_call')).toBe(false);
    const done = events.at(-1)!;
    expect(done.type).toBe('done');
    expect(done.response?.tool_calls).toBeUndefined();
  });
});

describe('tokenizeLlamaSwap', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
  });

  it('returns token count from /upstream/{model}/tokenize', async () => {
    cleanup = mockFetch({
      '/tokenize': { ok: true, json: () => ({ tokens: [10, 20, 30] }) },
    });

    const count = await tokenizeLlamaSwap({
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
      content: 'hello world',
    });

    expect(count).toBe(3);
  });

  it('url-encodes the model segment for slash-bearing ids', async () => {
    let observedUrl: string | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      observedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return { ok: true, status: 200, json: async () => ({ tokens: [1, 2] }), text: async () => '' } as Response;
    }) as typeof globalThis.fetch;
    cleanup = () => {
      globalThis.fetch = originalFetch;
    };

    await tokenizeLlamaSwap({
      baseUrl: 'http://localhost:8080',
      model: 'org/model:tag',
      content: 'hi',
    });

    expect(observedUrl).toBe('http://localhost:8080/upstream/org%2Fmodel%3Atag/tokenize');
  });

  it('returns 0 for empty content without hitting the network', async () => {
    cleanup = mockFetch({});
    const count = await tokenizeLlamaSwap({
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
      content: '',
    });
    expect(count).toBe(0);
  });

  it('returns undefined on non-OK response', async () => {
    cleanup = mockFetch({
      '/tokenize': { ok: false, json: () => ({}) },
    });

    const count = await tokenizeLlamaSwap({
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
      content: 'hello',
    });

    expect(count).toBeUndefined();
  });
});
