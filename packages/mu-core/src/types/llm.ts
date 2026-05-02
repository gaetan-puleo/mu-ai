export interface ProviderConfig {
  baseUrl: string;
  model?: string;
  maxTokens: number;
  temperature: number;
  streamTimeoutMs: number;
  systemPrompt?: string;
  /**
   * Provider id to dispatch streaming through (`'openai'` by default).
   * Resolved by the registry's `ProviderRegistry`. Lets a single host run
   * multiple providers concurrently (e.g. coding via openai-compat,
   * vision via a different API).
   */
  providerId?: string;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Subset of `promptTokens` that hit the prompt cache, when reported by the
   *  server (OpenAI: `usage.prompt_tokens_details.cached_tokens`; llama.cpp
   *  newer builds expose the same field). Undefined or 0 when unsupported. */
  cachedPromptTokens?: number;
}

export interface ImageAttachment {
  data: string; // base64 encoded
  mimeType: string; // e.g. 'image/jpeg'
  name: string; // filename for display
}

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolResultInfo {
  name: string;
  content: string;
  error?: boolean;
}

/**
 * Optional rendering hints carried alongside a ChatMessage. Lets plugins (and
 * the host) tweak how a message is presented without committing to a fully
 * custom renderer:
 *  - `color` overrides the role-default text/border color (e.g. agent color)
 *  - `prefix` is rendered inline before the content (e.g. `│ ` colored bar)
 *  - `badge` is shown in a small box before the body (e.g. agent name)
 *  - `hidden` keeps the message in the transcript (sent to the LLM) but skips
 *    its on-screen rendering — useful for system reminders.
 *  - `llmHidden` is the inverse: keep the message in the on-screen transcript
 *    but strip it from the LLM payload right before the network call. Useful
 *    for UI-only markers (subagent dispatch headers, status pings) that
 *    plugins want users to see but the model shouldn't read as conversation.
 */
export interface MessageDisplay {
  color?: string;
  prefix?: string;
  badge?: string;
  hidden?: boolean;
  llmHidden?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  reasoning?: string;
  images?: ImageAttachment[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolResult?: ToolResultInfo;
  toolCallArgs?: Record<string, string>;
  /**
   * Tag used by plugins to route this message to a custom renderer registered
   * with `PluginContext.ui.registerMessageRenderer`. When set and the renderer
   * is found, the renderer takes precedence over the role-default renderer.
   */
  customType?: string;
  /** Free-form bag for plugin-private state (e.g. agent name, sub-agent id). */
  meta?: Record<string, unknown>;
  /** Lightweight display tweaks; see `MessageDisplay`. */
  display?: MessageDisplay;
}

export type StreamChunk =
  | { type: 'reasoning'; text: string }
  | { type: 'content'; text: string }
  | { type: 'tool_call'; toolCall: ToolCall };

export interface StreamOptions {
  signal?: AbortSignal;
  onUsage?: (usage: Usage) => void;
  tools?: ToolDefinition[];
}

export interface ApiModel {
  id: string;
  /**
   * Maximum input + output token window the provider advertises for this
   * model. OpenAI itself doesn't expose this on `/models`; compat servers
   * (llama.cpp, LM Studio, vLLM, Ollama's openai shim, ...) often do under
   * names like `context_length`, `max_context_length`, or
   * `max_position_embeddings`. Omitted when the provider doesn't report it.
   */
  contextLimit?: number;
}
