import type { ChatMessage, ProviderConfig, StreamChunk, StreamOptions, ToolCall, Usage } from './types';

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
    const { done, value } = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Stream timed out after ${timeoutMs / 1000}s of inactivity`)), timeoutMs),
      ),
    ]);

    if (done) return;

    buffer += decoder.decode(value, { stream: true });
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

  const reader = res.body!.getReader();
  let usage: Usage | undefined;
  const toolCalls: Record<number, { id: string; name: string; arguments: string }> = {};

  try {
    for await (const event of readSSEEvents(reader, config.streamTimeoutMs)) {
      // Track token usage
      if (event.usage) {
        usage = {
          promptTokens: event.usage.prompt_tokens ?? 0,
          completionTokens: event.usage.completion_tokens ?? 0,
          totalTokens: event.usage.total_tokens ?? 0,
        };
      }

      const delta = event.choices?.[0]?.delta;
      if (!delta) continue;

      // Reasoning
      const reasoning = delta.reasoning_content || delta.reasoning;
      if (reasoning) {
        yield { type: 'reasoning', text: reasoning };
      }

      // Content
      if (delta.content) {
        yield { type: 'content', text: delta.content };
      }

      // Tool calls arrive as fragments — accumulate them
      if (delta.tool_calls) {
        for (const fragment of delta.tool_calls) {
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

      // Emit completed tool calls
      if (event.choices[0]?.finish_reason === 'tool_calls') {
        for (const tc of Object.values(toolCalls)) {
          const toolCall: ToolCall = {
            id: tc.id,
            function: { name: tc.name, arguments: tc.arguments },
          };
          yield { type: 'tool_call', toolCall };
        }
      }
    }
  } finally {
    reader.releaseLock();
    if (usage && options?.onUsage) {
      options.onUsage(usage);
    }
  }
}
