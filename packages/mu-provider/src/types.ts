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
  expanded?: boolean;
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
  name?: string;
}
