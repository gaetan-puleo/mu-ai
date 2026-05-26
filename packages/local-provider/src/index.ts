import type {
  ContextMap,
  ContextPartKind,
  LLMProvider,
  LLMProviderResult,
  LLMStreamEvent,
  Message,
  Plugin,
  Tool,
  ToolCall,
} from 'mu-core';
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import {
  collectLlamaSwapContext,
  detectLlamaSwap,
  getLlamaSwapOpenAIBaseUrl,
  LLAMA_SWAP_KIND,
  prepareLlamaSwapChatRequest,
  tokenizeLlamaSwap,
} from './backends/llama-swap';
import type {
  LocalBackendInfo,
  LocalLLMResponseContext,
  LocalModel,
  LocalProviderConfig,
} from './types';

export type {
  LLMResponseContextProps,
  LLMResponseContextSlot,
  LocalBackendIdentity,
  LocalBackendInfo,
  LocalBackendKind,
  LocalLLMResponseContext,
  LocalModel,
  LocalProviderConfig,
} from './types';

const DEFAULT_BASE_URL = 'http://localhost:8080';
let OpenAIClient = OpenAI;

export function setOpenAIClientForTesting(client: typeof OpenAI): void {
  OpenAIClient = client;
}

const backendDetectors = [{ kind: LLAMA_SWAP_KIND, detect: detectLlamaSwap }] as const;

export async function detectLocalBackend(config: {
  kind?: LocalProviderConfig['kind'];
  baseUrl?: string;
  apiKey?: string;
}): Promise<LocalBackendInfo> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

  if (config.kind) {
    for (const detector of backendDetectors) {
      if (detector.kind === config.kind) {
        const result = await detector.detect({ baseUrl, apiKey: config.apiKey });
        if (result) {
          return result;
        }
        throw new Error(`Cannot detect ${config.kind} backend at ${baseUrl}`);
      }
    }
    throw new Error(`Unknown backend kind: ${config.kind}`);
  }

  for (const detector of backendDetectors) {
    const result = await detector.detect({ baseUrl, apiKey: config.apiKey });
    if (result) {
      return result;
    }
  }

  throw new Error(`Unsupported local backend at ${baseUrl}`);
}

export async function listLocalModels(config: {
  kind?: LocalProviderConfig['kind'];
  baseUrl?: string;
  apiKey?: string;
}): Promise<LocalModel[]> {
  const backend = await detectLocalBackend(config);
  return backend.models;
}

function convertMessages(messages: Message[]): ChatCompletionMessageParam[] {
  return messages
    .filter((message) => message.role !== 'reasoning')
    .map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'tool',
          content: message.content,
          tool_call_id: message.tool_id ?? '',
        } as ChatCompletionMessageParam;
      }

      if (message.role === 'assistant' && message.tool_calls?.length) {
        return {
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.tool_calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: {
              name: call.tool,
              arguments: call.args,
            },
          })),
        } as ChatCompletionMessageParam;
      }

      return {
        role: message.role,
        content: message.content,
      } as ChatCompletionMessageParam;
    });
}

function convertTools(tools: Record<string, Tool>): ChatCompletionTool[] {
  return Object.values(tools).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function estimateTokens(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function estimateJsonTokens(value: unknown): number {
  return estimateTokens(JSON.stringify(value));
}

function toolContextKind(tool: Tool): ContextPartKind {
  const name = tool.name.toLowerCase();
  if (name.includes('skill')) return 'skills';
  if (name.startsWith('mcp') || name.includes('_mcp') || name.includes('mcp_')) return 'mcp';
  return 'tools';
}

export type TokenizeFn = (content: string) => Promise<number | undefined>;

const BUCKET_SEPARATOR = '\n\n';

function aggregateBuckets(messages: Message[], tools: Record<string, Tool>): Map<ContextPartKind, string[]> {
  const buckets = new Map<ContextPartKind, string[]>();
  const push = (kind: ContextPartKind, content: string) => {
    if (!content) return;
    const list = buckets.get(kind) ?? [];
    list.push(content);
    buckets.set(kind, list);
  };

  for (const message of messages) {
    if (message.role === 'system') {
      push('system', message.content);
    } else if (message.role === 'tool') {
      push('tool_results', message.content);
    } else if (message.role === 'user' || message.role === 'assistant') {
      push('messages', message.content);
      if (message.tool_calls?.length) {
        push('messages', JSON.stringify(message.tool_calls));
      }
    } else {
      push('other', message.content);
    }
  }

  for (const tool of Object.values(tools)) {
    const schema = convertTools({ [tool.name]: tool })[0];
    push(toolContextKind(tool), JSON.stringify(schema));
  }

  return buckets;
}

async function buildContextMap(config: {
  model: string;
  messages: Message[];
  tools: Record<string, Tool>;
  usage?: LocalLLMResponseContext['usage'];
  backendContext?: LocalLLMResponseContext;
  tokenize?: TokenizeFn;
}): Promise<ContextMap> {
  const buckets = aggregateBuckets(config.messages, config.tools);
  const entries = await Promise.all(
    Array.from(buckets.entries()).map(async ([kind, contents]) => {
      const joined = contents.join(BUCKET_SEPARATOR);
      const { tokens, estimated } = await countBucketTokens(joined, config.tokenize);
      return { kind, tokens, estimated };
    }),
  );

  const partsEstimated = entries.some((entry) => entry.estimated);
  const out = entries.map(({ kind, tokens, estimated }) => ({
    kind,
    label: labelContextPart(kind),
    tokens,
    estimated,
  }));

  const windowTokens = config.backendContext?.props?.n_ctx ?? config.backendContext?.currentSlot?.n_ctx;
  const usedTokens = config.usage?.promptTokens;

  return {
    model: config.model,
    usedTokens,
    windowTokens,
    estimated: partsEstimated,
    parts: out,
  };
}

async function countBucketTokens(content: string, tokenize?: TokenizeFn): Promise<{ tokens: number; estimated: boolean }> {
  if (!content) return { tokens: 0, estimated: false };
  if (tokenize) {
    const real = await tokenize(content);
    if (real !== undefined) return { tokens: real, estimated: false };
  }
  return { tokens: estimateTokens(content), estimated: true };
}

function labelContextPart(kind: ContextPartKind): string {
  switch (kind) {
    case 'system':
      return 'system';
    case 'tools':
      return 'tools';
    case 'messages':
      return 'messages';
    case 'tool_results':
      return 'tool results';
    case 'skills':
      return 'skills';
    case 'mcp':
      return 'mcp';
    case 'other':
      return 'other';
  }
}

export const createLocalProvider = (config: LocalProviderConfig): LLMProvider => {
  let backendPromise: Promise<LocalBackendInfo> | undefined;
  let client: OpenAI | undefined;

  return async (messages, tools): Promise<LLMProviderResult> => {
    backendPromise ??= detectLocalBackend({
      kind: config.kind,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: config.apiKey,
    });
    const backend = await backendPromise;

    if (!config.model) {
      throw new Error(
        `Local provider requires a model. Backend: ${backend.kind}. Available models: ${
          backend.models.map((m) => m.id).join(', ')
        }`,
      );
    }
    const model = config.model;

    client ??= new OpenAIClient({
      baseURL: getLlamaSwapOpenAIBaseUrl(backend.baseUrl),
      apiKey: config.apiKey ?? 'local',
    });

    const convertedTools = convertTools(tools);
    const requestOptions: Record<string, unknown> = {
      model,
      messages: convertMessages(messages),
      ...(convertedTools.length > 0 ? { tools: convertedTools } : {}),
      stream: true,
      stream_options: { include_usage: true },
    };

    let selectedSlotId: number | undefined;

    if (backend.kind === 'llama-swap') {
      const extras = await prepareLlamaSwapChatRequest({
        baseUrl: backend.baseUrl,
        apiKey: config.apiKey,
        model,
      });
      if (extras) {
        selectedSlotId = extras.id_slot;
        Object.assign(requestOptions, extras);
      }
    }

    async function* streamCompletion(): AsyncIterable<LLMStreamEvent> {
      let content = '';
      let usage: LocalLLMResponseContext['usage'] | undefined;
      const toolCallBuffers = new Map<number, { id: string; name: string; args: string; emitted: boolean }>();

      const stream = await client?.chat.completions.create(requestOptions as any);

      for await (const chunk of stream as any) {
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens ?? 0,
          };
        }

        const choice = chunk.choices?.[0];
        const choiceDelta = choice?.delta;
        const reasoningDelta = extractReasoningDelta(choiceDelta);
        if (reasoningDelta) {
          yield { type: 'reasoning_delta', content: reasoningDelta };
        }

        const delta = choiceDelta?.content;
        if (delta) {
          content += delta;
          yield { type: 'delta', content: delta };
        }

        const toolCallDeltas = choiceDelta?.tool_calls as
          | Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>
          | undefined;
        if (toolCallDeltas) {
          for (const tc of toolCallDeltas) {
            const idx = tc.index ?? 0;
            const buf = toolCallBuffers.get(idx) ?? { id: '', name: '', args: '', emitted: false };
            if (tc.id) buf.id = tc.id;
            if (tc.function?.name) buf.name = tc.function.name;
            if (tc.function?.arguments) buf.args += tc.function.arguments;
            toolCallBuffers.set(idx, buf);
          }
        }

        if (choice?.finish_reason === 'tool_calls') {
          for (const buf of toolCallBuffers.values()) {
            if (buf.emitted || !buf.name) continue;
            buf.emitted = true;
            yield {
              type: 'tool_call',
              call: { type: 'tool_call', id: buf.id, tool: buf.name, args: buf.args },
            };
          }
        }
      }

      // Fallback: emit any buffered tool calls that never saw a finish_reason chunk.
      for (const buf of toolCallBuffers.values()) {
        if (buf.emitted || !buf.name) continue;
        buf.emitted = true;
        yield {
          type: 'tool_call',
          call: { type: 'tool_call', id: buf.id, tool: buf.name, args: buf.args },
        };
      }

      let backendContext: LocalLLMResponseContext | undefined;

      if (backend.kind === 'llama-swap') {
        backendContext = await collectLlamaSwapContext({
          baseUrl: backend.baseUrl,
          apiKey: config.apiKey,
          model,
          selectedSlotId,
        });
      }

      const collectedToolCalls: ToolCall[] = [];
      for (const buf of toolCallBuffers.values()) {
        if (!buf.name) continue;
        collectedToolCalls.push({
          type: 'tool_call',
          id: buf.id,
          tool: buf.name,
          args: buf.args,
        });
      }

      const tokenize: TokenizeFn | undefined = backend.kind === 'llama-swap'
        ? (content: string) => tokenizeLlamaSwap({ baseUrl: backend.baseUrl, apiKey: config.apiKey, model, content })
        : undefined;

      const contextMap = backendContext || usage
        ? await buildContextMap({ model, messages, tools, usage, backendContext, tokenize })
        : undefined;

      yield {
        type: 'done',
        response: {
          content,
          tool_calls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
          context: backendContext || usage
            ? {
              ...backendContext,
              usage,
              contextMap,
            } as LocalLLMResponseContext
            : undefined,
        },
      };
    }

    return streamCompletion();
  };
};

function extractReasoningDelta(delta: unknown): string {
  if (!delta || typeof delta !== 'object') return '';
  const record = delta as Record<string, unknown>;
  const value = record.reasoning_content ?? record.reasoning ?? record.reasoningContent;
  return typeof value === 'string' ? value : '';
}

/**
 * Wrap `createLocalProvider` as a `Plugin` for uniform composition. Prefer
 * this in host wiring; use `createLocalProvider()` directly only when you
 * need the raw `LLMProvider` (e.g. tests).
 */
export const createLocalProviderPlugin = (config: LocalProviderConfig): Plugin => ({
  name: 'mu-local-provider',
  provider: createLocalProvider(config),
});
