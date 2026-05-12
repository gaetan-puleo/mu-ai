/**
 * Canonical ChatMessage factories.
 *
 * Every host that persists or constructs messages should use these so
 * the `meta` keys stay aligned with the strict `ChatMessageMeta` shape.
 * Replaces arya's previous `lib/messages.ts` and mu-coding's ad-hoc
 * literal construction sites.
 */

import { newMessageId, nowMs } from './ids';
import type { ChatMessageMeta } from './messageMeta';
import type { ChatMessage, MessageDisplay } from './types/llm';

export interface UserMessageOpts {
  /** Agent name attributed to this user turn (lands in `meta.agent`). */
  agent?: string;
}

/** Build a user `ChatMessage` with id + ts + optional agent attribution. */
export function makeUserMessage(text: string, opts: UserMessageOpts = {}): ChatMessage {
  const meta: ChatMessageMeta = {
    id: newMessageId('user'),
    ts: nowMs(),
  };
  if (opts.agent) meta.agent = opts.agent;
  return {
    role: 'user',
    content: text,
    meta,
  };
}

export interface AssistantMessageOpts {
  /** Agent name attributed to this message (lands in `meta.agent`). */
  agent?: string;
  /** Optional reasoning trace (separate from final content). */
  reasoning?: string;
}

/** Build an assistant `ChatMessage` with id + ts + optional agent attribution. */
export function makeAssistantMessage(text: string, opts: AssistantMessageOpts = {}): ChatMessage {
  const meta: ChatMessageMeta = {
    id: newMessageId('assistant'),
    ts: nowMs(),
  };
  if (opts.agent) meta.agent = opts.agent;
  const msg: ChatMessage = {
    role: 'assistant',
    content: text,
    meta,
  };
  if (opts.reasoning) msg.reasoning = opts.reasoning;
  return msg;
}

export interface ToolMessageInput {
  toolCallId?: string;
  toolName: string;
  /** Args object — pretty-printed into `meta.toolArgs`. */
  toolArgs?: Record<string, unknown>;
  /** Tool execution output (already a string). */
  toolResult: string;
  toolError?: boolean;
}

/** Build a tool-result `ChatMessage` with structured toolResult info. */
export function makeToolMessage(input: ToolMessageInput): ChatMessage {
  const meta: ChatMessageMeta = {
    id: newMessageId('tool', input.toolCallId),
    ts: nowMs(),
  };
  if (input.toolArgs) {
    meta.toolArgs = JSON.stringify(input.toolArgs, null, 2);
  }
  return {
    role: 'tool',
    content: '',
    toolCallId: input.toolCallId,
    toolResult: {
      name: input.toolName,
      content: input.toolResult,
      error: input.toolError === true,
    },
    meta,
  };
}

export interface SyntheticMessageOpts {
  role: 'user' | 'assistant' | 'system';
  content: string;
  customType?: string;
  display?: MessageDisplay;
  /** Agent name attributed to this synthetic message. */
  agent?: string;
  /** Provenance tag (e.g. 'mu-agents.mention-dispatch'). */
  source?: string;
  /** Correlate to a SubagentRun. */
  subagentRunId?: string;
}

/**
 * Build a synthetic `ChatMessage` — typically used by plugins that
 * inject status / dispatch / relay context into the live transcript
 * without going through the LLM stream.
 */
export function makeSyntheticMessage(opts: SyntheticMessageOpts): ChatMessage {
  const meta: ChatMessageMeta = {
    id: newMessageId(opts.role === 'system' ? 'assistant' : opts.role),
    ts: nowMs(),
  };
  if (opts.agent) meta.agent = opts.agent;
  if (opts.source) meta.source = opts.source;
  if (opts.subagentRunId) meta.subagentRunId = opts.subagentRunId;
  const msg: ChatMessage = {
    role: opts.role,
    content: opts.content,
    meta,
  };
  if (opts.customType) msg.customType = opts.customType;
  if (opts.display) msg.display = opts.display;
  return msg;
}
