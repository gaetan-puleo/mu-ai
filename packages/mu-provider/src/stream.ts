import OpenAI from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import type { ChatMessage, ProviderConfig, StreamChunk, StreamOptions, Usage } from './types';

// Local OpenAI-compatible servers (llama-swap, Ollama, LM Studio, …) often
// expose reasoning content via non-standard `reasoning_content` / `reasoning`
// delta fields. The SDK doesn't type these, so we read them via a structural
// extension and fall back to undefined when absent.
type DeltaWithReasoning = ChatCompletionChunk.Choice.Delta & {
  reasoning_content?: string | null;
  reasoning?: string | null;
};

// --- Message formatting ---

function buildMessages(messages: ChatMessage[], config: ProviderConfig): ChatCompletionMessageParam[] {
  const apiMessages: ChatCompletionMessageParam[] = [];

  if (config.systemPrompt) {
    apiMessages.push({ role: 'system', content: config.systemPrompt });
  }

  for (const m of messages) {
    if (m.role === 'user') {
      if (m.images?.length) {
        const parts: ChatCompletionContentPart[] = [
          { type: 'text', text: m.content.trim() || '(image attached)' },
          ...m.images.map(
            (img): ChatCompletionContentPart => ({
              type: 'image_url',
              image_url: { url: `data:${img.mimeType};base64,${img.data}` },
            }),
          ),
        ];
        apiMessages.push({ role: 'user', content: parts });
      } else {
        apiMessages.push({ role: 'user', content: m.content });
      }
    } else if (m.role === 'assistant') {
      if (m.toolCalls?.length) {
        apiMessages.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: tc.function,
          })),
        });
      } else {
        apiMessages.push({ role: 'assistant', content: m.content });
      }
    } else if (m.role === 'tool') {
      apiMessages.push({ role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content });
    } else if (m.role === 'system') {
      // System messages embedded in a transcript (e.g. resumed sessions where
      // an old prompt was persisted, or plugin-injected system context) are
      // forwarded verbatim. The leading `config.systemPrompt` is still pushed
      // first above so the canonical system instruction precedes any inline
      // ones — most servers tolerate multiple system messages.
      apiMessages.push({ role: 'system', content: m.content });
    }
  }

  return apiMessages;
}

// --- Tool call accumulation ---

type ToolCallAccumulator = Record<number, { id: string; name: string; arguments: string }>;

function accumulateToolCallFragments(
  toolCalls: ToolCallAccumulator,
  fragments: ChatCompletionChunk.Choice.Delta['tool_calls'],
): void {
  if (!fragments) return;
  for (const fragment of fragments) {
    if (!toolCalls[fragment.index]) {
      toolCalls[fragment.index] = { id: '', name: '', arguments: '' };
    }
    const accumulated = toolCalls[fragment.index];
    if (fragment.id) {
      accumulated.id = fragment.id;
    }
    if (fragment.function?.name) {
      accumulated.name += fragment.function.name;
    }
    if (fragment.function?.arguments) {
      accumulated.arguments += fragment.function.arguments;
    }
  }
}

function getCompletedToolCalls(toolCalls: ToolCallAccumulator): StreamChunk[] {
  return Object.values(toolCalls)
    .filter((tc) => tc.id && tc.name)
    .map((tc) => ({
      type: 'tool_call',
      toolCall: { id: tc.id, function: { name: tc.name, arguments: tc.arguments } },
    }));
}

function processChunkDeltas(delta: DeltaWithReasoning): StreamChunk[] {
  const chunks: StreamChunk[] = [];
  const reasoning = delta.reasoning_content || delta.reasoning;
  if (reasoning) {
    chunks.push({ type: 'reasoning', text: reasoning });
  }
  if (delta.content) {
    chunks.push({ type: 'content', text: delta.content });
  }
  return chunks;
}

// --- Inactivity timeout helper ---
//
// The OpenAI SDK exposes the streamed chunks as an async iterable but doesn't
// surface a per-chunk inactivity timeout. We wrap the iterator and race each
// `next()` against a timer so a stalled connection still raises promptly.
async function* withInactivityTimeout<T>(iter: AsyncIterable<T>, timeoutMs: number): AsyncGenerator<T> {
  const iterator = iter[Symbol.asyncIterator]();
  while (true) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Stream timed out after ${timeoutMs / 1000}s of inactivity`)),
            timeoutMs,
          );
        }),
      ]);
      if (result.done) return;
      yield result.value;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

// --- Main entry point ---

export async function* streamChat(
  messages: ChatMessage[],
  config: ProviderConfig,
  model: string,
  options?: StreamOptions,
): AsyncGenerator<StreamChunk, void, unknown> {
  // The SDK requires an apiKey to construct, but local OpenAI-compatible
  // servers (llama-swap, Ollama, LM Studio) don't enforce auth. A placeholder
  // satisfies the SDK without leaking real credentials.
  const client = new OpenAI({ baseURL: config.baseUrl, apiKey: 'sk-local' });

  // `cache_prompt` is a llama.cpp/llama-server extension (default: true) that
  // we expose explicitly for robustness — some proxies disable it. The OpenAI
  // hosted API ignores unknown fields, so this stays safe across providers.
  const params: ChatCompletionCreateParamsStreaming & { cache_prompt?: boolean } = {
    model,
    messages: buildMessages(messages, config),
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    stream: true,
    stream_options: { include_usage: true },
    cache_prompt: true,
  };

  if (options?.tools?.length) {
    params.tools = options.tools.map((t) => ({
      type: 'function',
      function: t.function,
    }));
  }

  const stream = await client.chat.completions.create(params, {
    signal: options?.signal,
  });

  yield* processStream(stream, config.streamTimeoutMs, options);
}

async function* processStream(
  stream: AsyncIterable<ChatCompletionChunk>,
  timeoutMs: number,
  options?: StreamOptions,
): AsyncGenerator<StreamChunk> {
  let usage: Usage | undefined;
  const toolCalls: ToolCallAccumulator = {};
  let toolCallsEmitted = false;

  try {
    for await (const event of withInactivityTimeout(stream, timeoutMs)) {
      if (event.usage) {
        // `prompt_tokens_details.cached_tokens` is reported by OpenAI's hosted
        // API and recent llama.cpp/llama-server builds. Older servers omit it;
        // we fall back to 0 so consumers can render `(N cached)` only when
        // meaningful without crashing on missing fields.
        const cachedTokens =
          (event.usage as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details
            ?.cached_tokens ?? 0;
        usage = {
          promptTokens: event.usage.prompt_tokens ?? 0,
          completionTokens: event.usage.completion_tokens ?? 0,
          totalTokens: event.usage.total_tokens ?? 0,
          cachedPromptTokens: cachedTokens,
        };
      }

      const delta = event.choices?.[0]?.delta as DeltaWithReasoning | undefined;
      if (!delta) continue;

      yield* processChunkDeltas(delta);
      accumulateToolCallFragments(toolCalls, delta.tool_calls);

      // Emit completed tool calls once when finish_reason signals completion.
      // Some providers send a trailing usage-only chunk that re-emits the same
      // finish_reason — guarding on `toolCallsEmitted` avoids duplicate yields.
      const finishReason = event.choices[0]?.finish_reason;
      if (!toolCallsEmitted && (finishReason === 'tool_calls' || finishReason === 'stop')) {
        const completed = getCompletedToolCalls(toolCalls);
        yield* completed;
        if (completed.length > 0) {
          toolCallsEmitted = true;
        }
      }
    }

    // Fallback: emit accumulated tool calls if not yet emitted (handles non-standard finish_reason)
    if (!toolCallsEmitted) {
      yield* getCompletedToolCalls(toolCalls);
    }
  } finally {
    if (usage && options?.onUsage) {
      options.onUsage(usage);
    }
  }
}
