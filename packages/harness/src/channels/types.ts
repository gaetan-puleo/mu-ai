import type { Message, ToolCall } from 'mu-core';

/**
 * Input event a channel pushes into the harness. The harness decides how
 * to route it (publish to the runtime, dispatch a command, switch session).
 */
export type ChannelInEvent =
  | { type: 'user_input'; text: string }
  | { type: 'command'; input: string }
  | { type: 'interrupt' }
  | { type: 'switch_session'; sessionId: string };

/**
 * Output event the harness sends back to a channel for rendering. Mirrors
 * the relevant CoreEvent types plus a few harness-level signals so channels
 * don't need to import mu-core.
 */
export type ChannelOutEvent =
  | { type: 'assistant_start' }
  | { type: 'assistant_delta'; content: string }
  | { type: 'assistant_message'; message: Message }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'reasoning_message'; message: Message }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; message: Message }
  | { type: 'command_result'; ok: boolean; output?: unknown; error?: string }
  | { type: 'session_switched'; sessionId: string }
  | { type: 'error'; error: unknown };

export interface ChannelContext {
  channelId: string;
  /** Called by the channel to deliver an input event to the harness. */
  deliver: (event: ChannelInEvent) => void | Promise<void>;
}

export interface Channel {
  /** Unique id, e.g. "tui", "telegram:chat-12345". */
  id: string;
  /** Family identifier, e.g. "tui", "telegram", "rpc". Useful for routing rules. */
  kind: string;
  /** Begin reading from the surface and surfacing input via `ctx.deliver`. */
  start(ctx: ChannelContext): void | Promise<void>;
  /** Clean shutdown. */
  stop(): void | Promise<void>;
  /** Render an event coming from the harness. Channels MAY ignore unknown events. */
  send(event: ChannelOutEvent): void | Promise<void>;
}
