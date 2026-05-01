import type { ChatMessage, ProviderConfig, StreamChunk, StreamOptions, Usage } from './types';

interface OpenAIChunk {
  choices: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      reasoning?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

// --- Message formatting ---

function buildMessages(messages: ChatMessage[], config: ProviderConfig) {
  const apiMessages: Record<string, unknown>[] = [];

  if (config.systemPrompt) {
    apiMessages.push({ role: 'system', content: config.systemPrompt });
  }

  for (const m of messages) {
    if (m.role === 'user') {
      let content: unknown = m.content;
      if (m.images?.length) {
        content = [
          { type: 'text', text: m.content.trim() || '(image attached)' },
          ...m.images.map((img) => ({
            type: 'image_url',
            image_url: { url: `data:${img.mimeType};base64,${img.data}` },
          })),
        ];
      }
      apiMessages.push({ role: 'user', content });
    } else if (m.role === 'assistant') {
      const msg: Record<string, unknown> = { role: 'assistant' };
      if (m.content) {
        msg.content = m.content;
      }
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: tc.function,
        }));
      }
      apiMessages.push(msg);
    } else if (m.role === 'tool') {
      apiMessages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    }
  }

  return apiMessages;
}

// --- SSE stream reader ---

async function* readSSEEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): AsyncGenerator<OpenAIChunk> {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Stream timed out after ${timeoutMs / 1000}s of inactivity`)),
            timeoutMs,
          );
        }),
      ]);

      if (done) return;

      buffer += decoder.decode(value, { stream: true });
    } finally {
      if (timer) clearTimeout(timer);
    }

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;

      try {
        yield JSON.parse(payload);
      } catch {
        // Skip malformed JSON
      }
    }
  }
}

// --- Tool call accumulation ---

type ToolCallAccumulator = Record<number, { id: string; name: string; arguments: string }>;

function accumulateToolCallFragments(
  toolCalls: ToolCallAccumulator,
  fragments: NonNullable<OpenAIChunk['choices'][0]['delta']>['tool_calls'],
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
      type: 'tool_call' as const,
      toolCall: { id: tc.id, function: { name: tc.name, arguments: tc.arguments } },
    }));
}

function processChunkDeltas(delta: NonNullable<OpenAIChunk['choices'][0]['delta']>): StreamChunk[] {
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

// --- Main entry point ---

export async function* streamChat(
  messages: ChatMessage[],
  config: ProviderConfig,
  model: string,
  options?: StreamOptions,
): AsyncGenerator<StreamChunk, void, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: buildMessages(messages, config),
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (options?.tools?.length) {
    body.tools = options.tools;
  }

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API error ${res.status}: ${errorText.slice(0, 500)}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('No response body from API');
  }

  yield* processStream(reader, config.streamTimeoutMs, options);
}

async function* processStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  options?: StreamOptions,
): AsyncGenerator<StreamChunk> {
  let usage: Usage | undefined;
  const toolCalls: ToolCallAccumulator = {};
  let toolCallsEmitted = false;

  try {
    for await (const event of readSSEEvents(reader, timeoutMs)) {
      if (event.usage) {
        usage = {
          promptTokens: event.usage.prompt_tokens ?? 0,
          completionTokens: event.usage.completion_tokens ?? 0,
          totalTokens: event.usage.total_tokens ?? 0,
        };
      }

      const delta = event.choices?.[0]?.delta;
      if (!delta) continue;

      yield* processChunkDeltas(delta);
      accumulateToolCallFragments(toolCalls, delta.tool_calls);

      // Emit completed tool calls when finish_reason signals completion
      const finishReason = event.choices[0]?.finish_reason;
      if (finishReason === 'tool_calls' || finishReason === 'stop') {
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
    reader.releaseLock();
    if (usage && options?.onUsage) {
      options.onUsage(usage);
    }
  }
}
