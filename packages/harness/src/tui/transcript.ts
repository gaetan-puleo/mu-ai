/**
 * Generic chat transcript model. Tracks the cross-agent state every chat UI
 * needs: user/assistant turns, streaming deltas, reasoning, tool calls, error
 * surfaces, and side-queued messages.
 *
 * Hosts extend the line union via the `Extra` generic — coding-agent adds
 * output-block toggles and sub-agent preview cards on top of the base shape;
 * a thinner host could pass `never` and use only the base lines.
 */
import type { CoreEvent, Message, ToolCall } from 'mu-core';

/**
 * The line shapes every chat UI emits. Agent-specific lines are added via
 * the `Extra` parameter on `TranscriptModel<Extra>`.
 */
export type BaseChatLine =
  | { role: 'user'; content: string; label?: string }
  | { role: 'assistant'; content: string }
  | { role: 'error'; content: string }
  | { role: 'reasoning'; content: string; closed?: boolean }
  | { role: 'tool'; callId: string; name: string; argsPreview: string };

export type UserChatLine = Extract<BaseChatLine, { role: 'user' }>;

/** Formatter for the per-tool-call args preview. Hosts inject their own. */
export type ToolCallFormatter = (toolName: string, rawArgs: string) => string;

interface VisibleQueuedLine {
  message: Message;
  queue: 'steering' | 'follow_up';
  line: UserChatLine;
}

export interface TranscriptOptions {
  /** Initial visibility for reasoning blocks. Defaults to `true`. */
  thinkingVisible?: boolean;
  /** How tool args render under each `tool` line. Defaults to `args.slice(0, 120)`. */
  formatToolCallArgs?: ToolCallFormatter;
  /** Label rendered on queued steering lines. Defaults to `'queued steering'`. */
  steeringLabel?: string;
  /** Label rendered on queued follow-up lines. Defaults to `'follow-up'`. */
  followUpLabel?: string;
}

const DEFAULT_TOOL_FORMATTER: ToolCallFormatter = (_name, raw) =>
  raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;

/**
 * Mutable transcript state. The host bus → UI loop calls `apply(event)` (or
 * the explicit `append*` methods) and re-renders from `lines`.
 *
 * `Extra` is the union of agent-specific line variants. Agents push them
 * directly into `lines`; the base methods only manipulate `BaseChatLine`s.
 */
export class TranscriptModel<Extra = never> {
  lines: Array<BaseChatLine | Extra> = [];
  visibleQueuedLines: VisibleQueuedLine[] = [];
  thinkingVisible: boolean;

  private pendingAssistantIndex: number | undefined;
  private pendingReasoningIndex: number | undefined;
  private queuedUserLines: UserChatLine[] = [];
  private readonly formatToolCallArgs: ToolCallFormatter;
  private readonly steeringLabel: string;
  private readonly followUpLabel: string;

  constructor(options: TranscriptOptions = {}) {
    this.thinkingVisible = options.thinkingVisible ?? true;
    this.formatToolCallArgs = options.formatToolCallArgs ?? DEFAULT_TOOL_FORMATTER;
    this.steeringLabel = options.steeringLabel ?? 'queued steering';
    this.followUpLabel = options.followUpLabel ?? 'follow-up';
  }

  reset(): void {
    this.lines = [];
    this.visibleQueuedLines = [];
    this.queuedUserLines = [];
    this.pendingAssistantIndex = undefined;
    this.pendingReasoningIndex = undefined;
  }

  resetPending(): void {
    this.queuedUserLines = [];
    this.pendingAssistantIndex = undefined;
    this.pendingReasoningIndex = undefined;
  }

  appendUser(content: string): void {
    this.lines.push({ role: 'user', content });
  }

  appendAssistantDelta(content: string): void {
    if (this.pendingAssistantIndex === undefined) {
      this.lines.push({ role: 'assistant', content: '' });
      this.pendingAssistantIndex = this.lines.length - 1;
    }
    const pending = this.lines[this.pendingAssistantIndex];
    if (isBaseLine(pending) && pending.role === 'assistant') pending.content += content;
  }

  appendAssistantMessage(message: Message): void {
    if (this.pendingAssistantIndex !== undefined) {
      const pending = this.lines[this.pendingAssistantIndex];
      if (isBaseLine(pending) && pending.role === 'assistant') pending.content = message.content;
      this.pendingAssistantIndex = undefined;
      return;
    }
    this.lines.push({ role: 'assistant', content: message.content });
  }

  appendReasoningDelta(content: string): void {
    if (this.pendingReasoningIndex === undefined) {
      const insertAt = this.pendingAssistantIndex ?? this.lines.length;
      this.lines.splice(insertAt, 0, { role: 'reasoning', content: '', closed: !this.thinkingVisible });
      this.pendingReasoningIndex = insertAt;
      if (this.pendingAssistantIndex !== undefined) this.pendingAssistantIndex++;
    }
    const pending = this.lines[this.pendingReasoningIndex];
    if (isBaseLine(pending) && pending.role === 'reasoning') pending.content += content;
  }

  appendReasoningMessage(content: string): void {
    if (this.pendingReasoningIndex !== undefined) {
      const pending = this.lines[this.pendingReasoningIndex];
      if (isBaseLine(pending) && pending.role === 'reasoning') pending.content = content;
      this.pendingReasoningIndex = undefined;
      return;
    }
    const insertAt = this.pendingAssistantIndex ?? this.lines.length;
    this.lines.splice(insertAt, 0, { role: 'reasoning', content, closed: !this.thinkingVisible });
    if (this.pendingAssistantIndex !== undefined) this.pendingAssistantIndex++;
  }

  appendToolCall(call: ToolCall): void {
    this.lines.push({
      role: 'tool',
      callId: call.id,
      name: call.name,
      argsPreview: this.formatToolCallArgs(call.name, call.args),
    });
  }

  appendError(msg: string): void {
    this.pendingAssistantIndex = undefined;
    this.pendingReasoningIndex = undefined;
    this.lines.push({ role: 'error', content: msg });
  }

  appendQueuedMessage(message: Message, queue: 'steering' | 'follow_up'): void {
    const visibleIndex = this.visibleQueuedLines.findIndex((entry) => entry.message === message);
    const line = visibleIndex === -1
      ? this.createQueuedUserLine(message, queue)
      : this.visibleQueuedLines.splice(visibleIndex, 1)[0].line;

    this.lines.push(line);
    this.queuedUserLines.push(line);
  }

  appendVisibleQueuedMessage(message: Message, queue: 'steering' | 'follow_up'): void {
    if (this.visibleQueuedLines.some((entry) => entry.message === message)) return;
    this.visibleQueuedLines.push({ message, queue, line: this.createQueuedUserLine(message, queue) });
  }

  activateNextQueuedUserMessage(): void {
    const line = this.queuedUserLines.shift();
    if (line) delete line.label;
  }

  toggleThinking(): void {
    this.thinkingVisible = !this.thinkingVisible;
    for (const entry of this.lines) {
      if (isBaseLine(entry) && entry.role === 'reasoning') entry.closed = !this.thinkingVisible;
    }
  }

  openThinkingLine(line: Extract<BaseChatLine, { role: 'reasoning' }>): void {
    if (!line.closed) return;
    line.closed = false;
  }

  /**
   * Apply a `CoreEvent` to the transcript. Returns `true` when the event
   * mutated state (so the host knows to re-render). Events not recognized by
   * the base transcript (e.g. `tool_result`, `queue_update`) return `false`
   * — hosts can either handle them themselves or ignore.
   *
   * Side-effect: on any "turn started" signal (`assistant_*`,
   * `reasoning_*`, `tool_call`) the head of the queued-user-lines is
   * un-faded via `activateNextQueuedUserMessage()`. This matches what every
   * chat UI wants: as soon as the model responds, the previously-queued
   * user line stops looking pending.
   */
  apply(event: CoreEvent): boolean {
    switch (event.type) {
      case 'user_message':
        this.appendUser(event.message.content);
        return true;
      case 'assistant_start':
        this.activateNextQueuedUserMessage();
        return false;
      case 'assistant_delta':
        this.activateNextQueuedUserMessage();
        this.appendAssistantDelta(event.content);
        return true;
      case 'assistant_message':
        this.activateNextQueuedUserMessage();
        this.appendAssistantMessage(event.message);
        return true;
      case 'reasoning_delta':
        this.activateNextQueuedUserMessage();
        this.appendReasoningDelta(event.content);
        return true;
      case 'reasoning_message':
        this.activateNextQueuedUserMessage();
        this.appendReasoningMessage(event.content);
        return true;
      case 'tool_call':
        this.activateNextQueuedUserMessage();
        this.appendToolCall(event.call);
        return true;
      case 'queued_message':
        this.appendQueuedMessage(event.message, event.queue);
        return true;
      case 'error':
        this.appendError(formatErrorForDisplay(event.error));
        return true;
      default:
        return false;
    }
  }

  private createQueuedUserLine(message: Message, queue: 'steering' | 'follow_up'): UserChatLine {
    return {
      role: 'user',
      content: message.content,
      label: queue === 'steering' ? this.steeringLabel : this.followUpLabel,
    };
  }
}

function isBaseLine(line: unknown): line is BaseChatLine {
  return typeof line === 'object' && line !== null && 'role' in line;
}

function formatErrorForDisplay(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
