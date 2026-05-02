/**
 * OpenAI-compat message + chunk + usage format helpers. Reusable from any
 * adapter that speaks the OpenAI Chat Completions wire format (Ollama,
 * llama-swap, LM Studio, ...).
 */

import type { ChatMessage, ParsedChatEvent, ProviderConfig, Usage } from 'mu-core';

interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | OpenAIContentPart[] | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export function toOpenAIMessages(messages: ChatMessage[], config: ProviderConfig): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  if (config.systemPrompt) out.push({ role: 'system', content: config.systemPrompt });
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.images?.length) {
        const parts: OpenAIContentPart[] = [
          { type: 'text', text: m.content.trim() || '(image attached)' },
          ...m.images.map((img) => ({
            type: 'image_url' as const,
            image_url: { url: `data:${img.mimeType};base64,${img.data}` },
          })),
        ];
        out.push({ role: 'user', content: parts });
      } else {
        out.push({ role: 'user', content: m.content });
      }
    } else if (m.role === 'assistant') {
      if (m.toolCalls?.length) {
        out.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: tc.function })),
        });
      } else {
        out.push({ role: 'assistant', content: m.content });
      }
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content });
    } else if (m.role === 'system') {
      out.push({ role: 'system', content: m.content });
    }
  }
  return out;
}

interface OpenAIChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning?: string;
      reasoning_content?: string;
      tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

export function parseOpenAIUsage(json: OpenAIChunk): Usage | null {
  if (!json.usage) return null;
  const u = json.usage;
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
    cachedPromptTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

/**
 * Parse a single OpenAI SSE chunk. Returns one chunk event per line; tool
 * call accumulation is left to the consumer (or — for the simpler path — we
 * only emit fully formed tool calls when finish_reason signals completion).
 *
 * For streaming text/reasoning, we emit `chunk` events directly. Tool calls
 * are emitted as `chunk` of type `tool_call` only when complete (finish
 * reason or `[DONE]`). Partial accumulation across calls is the caller's
 * responsibility — for adapters wired through `createProvider`, this means
 * the adapter is stateless across messages but the `runAgent` loop handles
 * tool boundaries via the streamed events.
 *
 * Simpler approach used here: return text/reasoning as they arrive; ignore
 * tool_call deltas (return null) — handled by the SDK path. A full adapter
 * implementation that supports tools end-to-end through createProvider
 * requires per-stream state and is left for the next iteration when the
 * SDK-based `streamChat` is fully removed.
 */
export function parseOpenAIChunk(raw: string): ParsedChatEvent {
  if (raw === '[DONE]') return { kind: 'done' };
  let json: OpenAIChunk;
  try {
    json = JSON.parse(raw) as OpenAIChunk;
  } catch {
    return null;
  }
  const usage = parseOpenAIUsage(json);
  if (usage) return { kind: 'usage', usage };
  const delta = json.choices?.[0]?.delta;
  if (!delta) return null;
  if (delta.reasoning_content) return { kind: 'chunk', chunk: { type: 'reasoning', text: delta.reasoning_content } };
  if (delta.reasoning) return { kind: 'chunk', chunk: { type: 'reasoning', text: delta.reasoning } };
  if (delta.content) return { kind: 'chunk', chunk: { type: 'content', text: delta.content } };
  return null;
}
