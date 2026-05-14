import { type Message, type ProviderConfig, type StreamChunk, type StreamOptions, type Tool, type Usage, debugLog } from 'mu-core';
import OpenAI from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';

// Local OpenAI-compatible servers (llama-swap, Ollama, LM Studio, …) often
// expose reasoning content via non-standard `reasoning_content` / `reasoning`
// delta fields. The SDK doesn't type these, so we read them via a structural
// extension and fall back to undefined when absent.
type DeltaWithReasoning = ChatCompletionChunk.Choice.Delta & {
  reasoning_content?: string | null;
  reasoning?: string | null;
};

// --- Message formatting ---

function buildMessages(messages: Message[], config: ProviderConfig): ChatCompletionMessageParam[] {
  const apiMessages: ChatCompletionMessageParam[] = [];

  if (config.systemPrompt) {
    apiMessages.push({ role: 'system', content: config.systemPrompt });
  }

  for (const m of messages) {
    if (m.role === 'user') {
      apiMessages.push({ role: 'user', content: m.content });
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
      const content = m.toolResult?.content ?? m.content;
      apiMessages.push({ role: 'tool', tool_call_id: m.toolCallId ?? '', content });
    } else if (m.role === 'system') {
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
    const accumulated = toolCalls[fragment.index]!;
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
    debugLog('provider', 'delta.content', { len: delta.content.length });
  } else if (delta.content === '') {
    // Empty-string content deltas — informational, no chunk yielded.
    debugLog('provider', 'delta.content.empty', {});
  }
  return chunks;
}

// --- Main entry point ---

// Tools are forwarded to the OpenAI-compatible server with full schema:
// the function name, description, and JSON-Schema `parameters` block from
// every registered `Tool`. This is the structured channel for tool
// information — textual usage hints from `api.systemPrompt(...)`
// contributions ride along inside the leading `system` message.
function toOpenAITool(t: Tool): { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } } {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

export async function* streamChat(
  messages: Message[],
  config: ProviderConfig,
  options?: StreamOptions,
): AsyncGenerator<StreamChunk, void, unknown> {
  // The SDK requires an apiKey to construct, but local OpenAI-compatible
  // servers (llama-swap, Ollama, LM Studio) don't enforce auth. A placeholder
  // satisfies the SDK without leaking real credentials.
  const client = new OpenAI({ baseURL: config.baseUrl, apiKey: 'sk-local' });

  if (!config.model) {
    throw new Error(
      'No model selected. Pick one via the TUI model picker (/model), pass --model <id>, or set "model" in ~/.config/mu/config.json.',
    );
  }

  const params: ChatCompletionCreateParamsStreaming & { cache_prompt?: boolean } = {
    model: config.model,
    messages: buildMessages(messages, config),
    stream: true,
    stream_options: { include_usage: true },
    cache_prompt: true,
  };

  if (options?.tools?.length) {
    params.tools = options.tools.map(toOpenAITool);
  }

  const stream = await client.chat.completions.create(params, {
    signal: options?.signal,
  });

  yield* processStream(stream, options);
}

async function* processStream(
  stream: AsyncIterable<ChatCompletionChunk>,
  options?: StreamOptions,
): AsyncGenerator<StreamChunk> {
  let usage: Usage | undefined;
  const toolCalls: ToolCallAccumulator = {};
  let toolCallsEmitted = false;
  let cumulativeContent = 0;
  let chunkCount = 0;
  let lastFinishReason: string | null | undefined;

  debugLog('provider', 'processStream.start', {});
  try {
    for await (const event of stream) {
      chunkCount++;
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
      if (!delta) {
        debugLog('provider', 'chunk.no_delta', { hasUsage: !!event.usage, choices: event.choices?.length ?? 0 });
        continue;
      }

      if (delta.content) cumulativeContent += delta.content.length;
      yield* processChunkDeltas(delta);
      accumulateToolCallFragments(toolCalls, delta.tool_calls);

      // Emit completed tool calls once when finish_reason signals completion.
      // Some providers send a trailing usage-only chunk that re-emits the same
      // finish_reason — guarding on `toolCallsEmitted` avoids duplicate yields.
      const finishReason = event.choices[0]?.finish_reason;
      if (finishReason) {
        lastFinishReason = finishReason;
        debugLog('provider', 'finish_reason', { reason: finishReason, cumulativeContent });
      }
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
    debugLog('provider', 'processStream.end', {
      chunkCount,
      cumulativeContent,
      lastFinishReason: lastFinishReason ?? 'none',
    });
  } catch (err) {
    debugLog('provider', 'processStream.error', {
      chunkCount,
      cumulativeContent,
      lastFinishReason: lastFinishReason ?? 'none',
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    if (usage && options?.onUsage) {
      options.onUsage(usage);
    }
  }
}
