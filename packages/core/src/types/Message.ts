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
 *
 * Every variant shares optional `id?` (stable across persists — hosts may
 * use it for fork-by-id, idempotent re-publishing, telemetry) and
 * `timestamp?` (ms since epoch). The runtime itself never reads them; it
 * just round-trips whatever the host writes.
 */
interface MessageMetadata {
  /** Stable per-message id (UUID, ULID, etc.). Hosts assign; runtime preserves. */
  id?: string;
  /** Wall-clock ms. Hosts assign on insert. */
  timestamp?: number;
}

export interface SystemMessage extends MessageMetadata {
  role: 'system';
  content: string;
}

export interface UserMessage extends MessageMetadata {
  role: 'user';
  content: string;
}

export interface AssistantMessage extends MessageMetadata {
  role: 'assistant';
  content: string;
  tool_calls?: ToolCall[];
  reasoning?: string;
}

export interface ToolMessage extends MessageMetadata {
  role: 'tool';
  tool_id: string;
  content: string;
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;
