import type { ToolCall } from './Tool';

/**
 * Conversational transcript shape. `Message` is a discriminated union by
 * `role` so each variant carries exactly the fields its role allows — no
 * optional-field soup, no `{ role: 'user', tool_id: 'x' }` accidents.
 *
 * Reasoning lives on `AssistantMessage` (alongside `content` and
 * `tool_calls`) rather than as its own variant: the LLM emits reasoning
 * together with the assistant turn, and providers that send reasoning to
 * the model would do so as part of the assistant entry.
 */
export interface SystemMessage {
  role: 'system';
  content: string;
}

export interface UserMessage {
  role: 'user';
  content: string;
}

export interface AssistantMessage {
  role: 'assistant';
  content: string;
  tool_calls?: ToolCall[];
  reasoning?: string;
}

export interface ToolMessage {
  role: 'tool';
  tool_id: string;
  content: string;
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;
