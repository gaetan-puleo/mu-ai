import { appendFileSync } from 'node:fs';
import type {
  LLMProvider,
  LLMProviderResult,
  LLMResponseContext,
  LLMStreamEvent,
  Message,
  Tool,
  ToolCall,
} from 'mu-core';
import { defineProvider } from 'mu-core';
import OpenAI from 'openai';
import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import {
  collectLlamaSwapContext,
  detectLlamaSwap,
  getLlamaSwapOpenAIBaseUrl,
  LLAMA_SWAP_KIND,
  prepareLlamaSwapChatRequest,
} from './backends/llama-swap';
import type { LocalBackendInfo, LocalContextMap, LocalContextPartKind, LocalModel, LocalProviderConfig } from './types';

export type {
  LocalBackendIdentity,
  LocalBackendInfo,
  LocalBackendKind,
  LocalContextMap,
  LocalContextPart,
  LocalContextPartKind,
  LocalModel,
  LocalProviderConfig,
} from './types';

const DEFAULT_BASE_URL = 'http://localhost:8080';
const DEBUG_LOG = process.env.MU_TUI_DEBUG_LOG;

function debugLog(data: Record<string, unknown>): void {
  if (!DEBUG_LOG) return;
  try {
    appendFileSync(DEBUG_LOG, `${JSON.stringify({ ts: Date.now(), source: 'mu-local-provider', ...data })}\n`);
  } catch {
    /* ignore debug logging errors */
  }
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

function _convertToolCalls(toolCalls: NonNullable<ChatCompletionMessage['tool_calls']>): ToolCall[] {
  return toolCalls
    .filter((toolCall) => toolCall.type === 'function')
    .map((toolCall) => ({
      type: 'tool_call',
      id: toolCall.id,
      tool: toolCall.function.name,
      args: toolCall.function.arguments,
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

function toolContextKind(tool: Tool): LocalContextPartKind {
  const name = tool.name.toLowerCase();
  if (name.includes('skill')) return 'skills';
  if (name.startsWith('mcp') || name.includes('_mcp') || name.includes('mcp_')) return 'mcp';
  return 'tools';
}

function addContextTokens(parts: Map<LocalContextPartKind, number>, kind: LocalContextPartKind, tokens: number): void {
  if (tokens <= 0) return;
  parts.set(kind, (parts.get(kind) ?? 0) + tokens);
}

function buildLocalContextMap(config: {
  backend: LocalBackendInfo;
  model: string;
  messages: Message[];
  tools: Record<string, Tool>;
  usage?: LLMResponseContext['usage'];
  backendContext?: LLMResponseContext;
}): LocalContextMap {
  const parts = new Map<LocalContextPartKind, number>();

  for (const message of config.messages) {
    if (message.role === 'system') {
      addContextTokens(parts, 'system', estimateTokens(message.content));
    } else if (message.role === 'tool') {
      addContextTokens(parts, 'tool_results', estimateTokens(message.content));
    } else if (message.role === 'user' || message.role === 'assistant') {
      addContextTokens(
        parts,
        'messages',
        estimateTokens(message.content) + estimateJsonTokens(message.tool_calls ?? []),
      );
    } else {
      addContextTokens(parts, 'other', estimateTokens(message.content));
    }
  }

  for (const tool of Object.values(config.tools)) {
    const schema = convertTools({ [tool.name]: tool })[0];
    addContextTokens(parts, toolContextKind(tool), estimateJsonTokens(schema));
  }

  const windowTokens = config.backendContext?.props?.n_ctx ?? config.backendContext?.currentSlot?.n_ctx;
  const usedTokens = config.usage?.promptTokens;
  const out = Array.from(parts.entries()).map(([kind, tokens]) => ({
    kind,
    label: labelContextPart(kind),
    tokens,
    estimated: true,
  }));

  return {
    provider: 'mu-local-provider',
    backend: config.backend.kind,
    model: config.model,
    usedTokens,
    windowTokens,
    estimated: true,
    parts: out,
  };
}

function labelContextPart(kind: LocalContextPartKind): string {
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
    case 'empty':
      return 'empty';
  }
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Provider closure owns cached backend/client state.
export const createLocalProvider = defineProvider<LocalProviderConfig>((config): LLMProvider => {
  let backendPromise: Promise<LocalBackendInfo> | undefined;
  let client: OpenAI | undefined;

  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: Request construction and stream creation share provider-local state.
  return async (messages, tools): Promise<LLMProviderResult> => {
    backendPromise ??= detectLocalBackend({
      kind: config.kind,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: config.apiKey,
    });
    const backend = await backendPromise;

    if (!config.model) {
      throw new Error(
        `Local provider requires a model. Backend: ${backend.kind}. Available models: ${backend.models.map((m) => m.id).join(', ')}`,
      );
    }
    const model = config.model;

    client ??= new OpenAI({
      baseURL: getLlamaSwapOpenAIBaseUrl(backend.baseUrl),
      apiKey: config.apiKey ?? 'local',
    });

    const requestOptions: Record<string, unknown> = {
      model,
      messages: convertMessages(messages),
      tools: convertTools(tools),
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

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Streaming OpenAI-compatible chunks requires ordered buffering and finalization.
    // biome-ignore lint/complexity/noExcessiveLinesPerFunction: Keeping stream chunk state together avoids splitting the buffering protocol.
    async function* streamCompletion(): AsyncIterable<LLMStreamEvent> {
      let content = '';
      let usage: LLMResponseContext['usage'] | undefined;
      const toolCallBuffers = new Map<number, { id: string; name: string; args: string; emitted: boolean }>();

      debugLog({ stage: 'provider.stream.start', model, messages: messages.length, tools: Object.keys(tools) });
      // biome-ignore lint/suspicious/noExplicitAny: OpenAI's streaming overload does not accept the normalized request object type directly.
      const stream = await client?.chat.completions.create(requestOptions as any);

      // biome-ignore lint/suspicious/noExplicitAny: OpenAI-compatible backends may add provider-specific streaming fields.
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
            debugLog({
              stage: 'provider.stream.tool_call_delta',
              index: idx,
              id: buf.id,
              tool: buf.name,
              argsLen: buf.args.length,
              deltaArgsLen: tc.function?.arguments?.length ?? 0,
            });
          }
        }

        if (choice?.finish_reason === 'tool_calls') {
          debugLog({ stage: 'provider.stream.finish_tool_calls', buffered: toolCallBuffers.size });
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
        debugLog({
          stage: 'provider.stream.tool_call_fallback_emit',
          id: buf.id,
          tool: buf.name,
          argsLen: buf.args.length,
        });
        yield {
          type: 'tool_call',
          call: { type: 'tool_call', id: buf.id, tool: buf.name, args: buf.args },
        };
      }

      let backendContext: LLMResponseContext | undefined;

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

      yield {
        type: 'done',
        response: {
          content,
          tool_calls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
          context:
            backendContext || usage
              ? ({
                  ...backendContext,
                  usage,
                  localContext: buildLocalContextMap({ backend, model, messages, tools, usage, backendContext }),
                } as LLMResponseContext)
              : undefined,
        },
      };
      debugLog({ stage: 'provider.stream.done', contentLen: content.length, toolCalls: collectedToolCalls.length });
    }

    return streamCompletion();
  };
});

function extractReasoningDelta(delta: unknown): string {
  if (!delta || typeof delta !== 'object') return '';
  const record = delta as Record<string, unknown>;
  const value = record.reasoning_content ?? record.reasoning ?? record.reasoningContent;
  return typeof value === 'string' ? value : '';
}
