import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectLocalBackend, listLocalModels, createLocalProvider } from './index';
import {
  normalizeLlamaSwapBaseUrl,
  getLlamaSwapOpenAIBaseUrl,
  selectAvailableSlot,
  prepareLlamaSwapChatRequest,
  collectLlamaSwapContext,
} from './backends/llama-swap';

let mockCreateChatCompletion = vi.fn();

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockCreateChatCompletion,
      },
    };
  },
}));

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
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
  });
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

describe('selectAvailableSlot', () => {
  it('selects first non-processing slot', () => {
    const slot = selectAvailableSlot(MOCK_SLOTS_RESPONSE);
    expect(slot).toBeDefined();
    expect(slot?.id).toBe(0);
  });

  it('falls back to first slot when all are processing', () => {
    const allBusy = MOCK_SLOTS_RESPONSE.map((s) => ({ ...s, is_processing: true }));
    const slot = selectAvailableSlot(allBusy);
    expect(slot).toBeDefined();
    expect(slot?.id).toBe(0);
  });

  it('returns undefined for empty array', () => {
    expect(selectAvailableSlot([])).toBeUndefined();
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
    mockCreateChatCompletion.mockReset();
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

    mockCreateChatCompletion.mockImplementation(async (options: unknown) => {
      requestOptions = options as Record<string, unknown>;
      return (async function* () {
        yield { choices: [{ delta: { content: 'hello' } }] };
        yield { choices: [], usage: { prompt_tokens: 1234, completion_tokens: 5, total_tokens: 1239 } };
      })() as any;
    });

    const provider = createLocalProvider({
      kind: 'llama-swap',
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
    });
    const result = await provider([], {});
    const events = [];

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
          localContext: {
            provider: 'mu-local-provider',
            backend: 'llama-swap',
            model: 'gemma-4-e2b',
            usedTokens: 1234,
            windowTokens: 32000,
            estimated: true,
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

    mockCreateChatCompletion.mockImplementation(async () => {
      return (async function* () {
        yield { choices: [{ delta: { reasoning_content: 'think ' } }] };
        yield { choices: [{ delta: { reasoning: 'more ' } }] };
        yield { choices: [{ delta: { reasoningContent: 'now' } }] };
        yield { choices: [{ delta: { content: 'answer' } }] };
      })() as any;
    });

    const provider = createLocalProvider({
      kind: 'llama-swap',
      baseUrl: 'http://localhost:8080',
      model: 'gemma-4-e2b',
    });
    const result = await provider([], {});
    const events = [];

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
});
