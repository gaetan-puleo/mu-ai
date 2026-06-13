import type { ContentPart, Message, ModelModalities, Provider, StreamEvent, Tool, Usage } from 'mu-core';
import OpenAI from 'openai';
import type { Stream } from 'openai/core/streaming';
import type {
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { type Backend, detectBackend } from './backend';
import { type LocalBackendInfo, type LocalModel, type LocalProviderConfig, LocalProviderError } from './types';

export type {
  LLMResponseContextProps,
  LLMResponseContextSlot,
  LocalBackendInfo,
  LocalLLMResponseContext,
  LocalModel,
  LocalProviderConfig,
} from './types';
export { LocalProviderError } from './types';
export type { ModelModalities } from './backend';

const DEFAULT_BASE_URL = 'http://localhost:8080';

export async function detectLocalBackend(config: {
  kind?: LocalProviderConfig['kind'];
  baseUrl?: string;
  apiKey?: string;
}): Promise<LocalBackendInfo> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const found = await detectBackend({ baseUrl, apiKey: config.apiKey });
  if (found) return found.info;
  throw new LocalProviderError(
    config.kind ? `Cannot detect ${config.kind} backend at ${baseUrl}` : `Unsupported local backend at ${baseUrl}`,
    config.kind ? 'backend_unreachable' : 'backend_unsupported',
  );
}

export async function listLocalModels(config: {
  kind?: LocalProviderConfig['kind'];
  baseUrl?: string;
  apiKey?: string;
}): Promise<LocalModel[]> {
  const backend = await detectLocalBackend(config);
  return backend.models;
}

type ToolCallPart = Extract<ContentPart, { type: 'tool_call' }>;
type ToolCallDelta = ChatCompletionChunk.Choice.Delta.ToolCall;

const toBase64 = (data: Uint8Array): string => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const audioFormat = (mime: string): 'wav' | 'mp3' => (mime.includes('mp3') || mime.includes('mpeg') ? 'mp3' : 'wav');

const partsToText = (parts: ContentPart[]): string =>
  parts
    .map((part) =>
      part.type === 'text' ? part.text : part.type === 'tool_result' ? partsToText(part.content) : `[${part.type}]`
    )
    .join('');

const toUserContent = (parts: ContentPart[]): string | ChatCompletionContentPart[] => {
  if (parts.every((part) => part.type === 'text')) return partsToText(parts);
  return parts.map((part): ChatCompletionContentPart => {
    if (part.type === 'image') {
      return { type: 'image_url', image_url: { url: `data:${part.mime};base64,${toBase64(part.data)}` } };
    }
    if (part.type === 'audio') {
      return { type: 'input_audio', input_audio: { data: toBase64(part.data), format: audioFormat(part.mime) } };
    }
    return { type: 'text', text: part.type === 'text' ? part.text : `[${part.type}]` };
  });
};

const argsToString = (input: unknown): string => (typeof input === 'string' ? input : JSON.stringify(input ?? {}));

export const convertMessages = (messages: Message[]): ChatCompletionMessageParam[] => {
  const out: ChatCompletionMessageParam[] = [];
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === 'tool_result') {
        out.push({ role: 'tool', tool_call_id: part.id, content: partsToText(part.content) });
      }
    }
    const rest = message.content.filter((part) => part.type !== 'tool_result');
    if (rest.length === 0) continue;

    if (message.role === 'assistant') {
      const calls = rest.filter((part): part is ToolCallPart => part.type === 'tool_call');
      const text = rest.filter((part) => part.type === 'text').map((part) => (part as { text: string }).text).join('');
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length > 0
          ? {
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: 'function' as const,
              function: { name: call.name, arguments: argsToString(call.input) },
            })),
          }
          : {}),
      });
    } else if (message.role === 'system') {
      out.push({ role: 'system', content: partsToText(rest) });
    } else {
      out.push({ role: 'user', content: toUserContent(rest) });
    }
  }
  return out;
};

export const convertTools = (tools: Tool[]): ChatCompletionTool[] =>
  tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));

const parseArgs = (args: string): unknown => {
  if (!args) return {};
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
};

async function* streamChunks(
  client: OpenAI,
  requestOptions: ChatCompletionCreateParamsStreaming,
  hostSignal: AbortSignal | undefined,
  contextWindow: number | undefined,
): AsyncIterable<StreamEvent> {
  const buffers = new Map<string, { key: string; id: string; name: string; args: string; emitted: boolean }>();
  let finishReason: string | undefined;
  let syntheticKeyCounter = 0;
  let usage: Usage | undefined;

  const controller = new AbortController();

  const onHostAbort = () => controller.abort();
  if (hostSignal) {
    if (hostSignal.aborted) controller.abort();
    else hostSignal.addEventListener('abort', onHostAbort, { once: true });
  }

  function* flush(): Generator<ContentPart> {
    for (const buf of buffers.values()) {
      if (buf.emitted || !buf.name) continue;
      buf.emitted = true;
      yield { type: 'tool_call', id: buf.id || buf.key, name: buf.name, input: parseArgs(buf.args) };
    }
  }

  const stream: Stream<ChatCompletionChunk> = await client.chat.completions.create(requestOptions, {
    signal: controller.signal,
  });

  try {
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];

      const delta = choice?.delta?.content;
      if (delta) yield { type: 'text', text: delta };

      const reasoningDelta = choice?.delta as
        | { reasoning_content?: string; reasoning?: string; reasoningContent?: string }
        | undefined;
      const reasoning = reasoningDelta?.reasoning_content ?? reasoningDelta?.reasoning ??
        reasoningDelta?.reasoningContent;
      if (reasoning) yield { type: 'reasoning', text: reasoning };

      const toolCallDeltas = choice?.delta?.tool_calls as ToolCallDelta[] | undefined;
      if (toolCallDeltas) {
        for (const tc of toolCallDeltas) {
          const key = tc.index !== undefined ? `i:${tc.index}` : tc.id ? `id:${tc.id}` : `s:${syntheticKeyCounter++}`;
          const buf = buffers.get(key) ?? { key, id: '', name: '', args: '', emitted: false };
          if (tc.id) buf.id = tc.id;
          if (tc.function?.name) buf.name = tc.function.name;
          if (tc.function?.arguments) buf.args += tc.function.arguments;
          buffers.set(key, buf);
        }
      }

      if (chunk.usage) {
        usage = {
          input: chunk.usage.prompt_tokens,
          output: chunk.usage.completion_tokens,
          total: chunk.usage.total_tokens,
        };
      }

      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (choice?.finish_reason === 'tool_calls') yield* flush();
    }
  } catch (err) {
    hostSignal?.removeEventListener('abort', onHostAbort);
    if (hostSignal?.aborted) throw new Error('Local provider stream aborted by host');
    throw err;
  }
  hostSignal?.removeEventListener('abort', onHostAbort);

  if (finishReason === undefined || finishReason === 'tool_calls') yield* flush();

  if (usage || contextWindow !== undefined) {
    yield { type: 'usage', usage: { ...usage, ...(contextWindow !== undefined ? { contextWindow } : {}) } };
  }
}

export const createLocalProvider = (config: LocalProviderConfig = {}): Provider => {
  let detected: Promise<{ backend: Backend; info: LocalBackendInfo }> | undefined;
  let client: OpenAI | undefined;
  const ctxByModel = new Map<string, number | undefined>();
  const capsByModel = new Map<string, ModelModalities | undefined>();

  const ensureBackend = (): Promise<{ backend: Backend; info: LocalBackendInfo }> => {
    if (!detected) {
      detected = detectBackend({ baseUrl: config.baseUrl ?? DEFAULT_BASE_URL, apiKey: config.apiKey })
        .then((found) => {
          if (found) return found;
          throw new LocalProviderError(
            config.kind ? `Cannot detect ${config.kind} backend` : 'Unsupported local backend',
            config.kind ? 'backend_unreachable' : 'backend_unsupported',
          );
        })
        .catch((err) => {
          detected = undefined;
          throw err;
        });
    }
    return detected;
  };

  return {
    async capabilities(modelRef: string): Promise<ModelModalities | undefined> {
      const model = modelRef || config.model;
      if (!model) return undefined;
      if (capsByModel.has(model)) return capsByModel.get(model);
      const { backend, info } = await ensureBackend();
      // Probing /props loads the model — intended: call this on model selection.
      const modalities = await backend.modalities({ baseUrl: info.baseUrl, apiKey: config.apiKey, model })
        .catch(() => undefined);
      capsByModel.set(model, modalities);
      return modalities;
    },

    async *stream(req) {
      const model = req.model || config.model;
      if (!model) throw new LocalProviderError('No model specified', 'config_invalid');

      const { backend, info } = await ensureBackend();

      const ClientCtor = config.openAIClient ?? OpenAI;
      client ??= new ClientCtor({
        baseURL: backend.openAIBaseUrl(info.baseUrl),
        apiKey: config.apiKey ?? 'local',
      });

      const tools = convertTools(req.tools);
      const requestOptions: ChatCompletionCreateParamsStreaming & { id_slot?: number; cache_prompt?: boolean } = {
        model,
        messages: convertMessages(req.messages),
        ...(tools.length > 0 ? { tools } : {}),
        stream: true,
        stream_options: { include_usage: true },
      };

      const extras = await backend.prepareChatRequest({ baseUrl: info.baseUrl, apiKey: config.apiKey, model });
      if (extras) Object.assign(requestOptions, extras);

      if (!ctxByModel.has(model)) {
        const ctx = await backend.contextWindow({ baseUrl: info.baseUrl, apiKey: config.apiKey, model })
          .catch(() => undefined);
        ctxByModel.set(model, ctx);
        // Reuse modalities already probed by capabilities() (on model select); otherwise read
        // them from the same `/props` we just fetched for the context window.
        const modalities = capsByModel.has(model)
          ? capsByModel.get(model)
          : await backend.modalities({ baseUrl: info.baseUrl, apiKey: config.apiKey, model }).catch(() => undefined);
        capsByModel.set(model, modalities);
        config.onModelInfo?.({ model, contextWindow: ctx, modalities });
      }

      yield* streamChunks(
        client,
        requestOptions,
        req.signal,
        ctxByModel.get(model),
      );
    },
  };
};
