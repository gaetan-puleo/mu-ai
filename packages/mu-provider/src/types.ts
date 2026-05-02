export interface ProviderConfig {
  baseUrl: string;
  model?: string;
  maxTokens: number;
  temperature: number;
  streamTimeoutMs: number;
  systemPrompt?: string;
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
 */
export interface MessageDisplay {
  color?: string;
  prefix?: string;
  badge?: string;
  hidden?: boolean;
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
}
