import type { CoreEvent, Message } from 'mu-core';
import { formatToolCallArgs } from './components/ToolLine';
import type { OutputBlock } from './components/OutputBlock';
import type { Roundtrip } from '../runtime/RoundtripStore';

export type ChatLine =
  | { role: 'user'; content: string; label?: 'queued steering' | 'follow-up' }
  | { role: 'assistant' | 'error'; content: string }
  | { role: 'command'; content: string }
  | { role: 'command_result'; content: string }
  | { role: 'output_block'; component: OutputBlock }
  | { role: 'context'; roundtrip?: Roundtrip }
  | { role: 'reasoning'; content: string; closed?: boolean }
  | { role: 'tool'; callId: string; name: string; argsPreview: string };

export type UserChatLine = Extract<ChatLine, { role: 'user' }>;

interface VisibleQueuedLine {
  message: Message;
  queue: 'steering' | 'follow_up';
  line: UserChatLine;
}

export class Transcript {
  lines: ChatLine[] = [];
  visibleQueuedLines: VisibleQueuedLine[] = [];
  thinkingVisible: boolean;

  private pendingAssistantIndex: number | undefined;
  private pendingReasoningIndex: number | undefined;
  private queuedUserLines: UserChatLine[] = [];

  constructor(thinkingVisible = true) {
    this.thinkingVisible = thinkingVisible;
  }

  reset(): void {
    this.lines = [];
    this.visibleQueuedLines = [];
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
    if (pending?.role === 'assistant') pending.content += content;
  }

  appendAssistantMessage(message: Message): void {
    if (this.pendingAssistantIndex !== undefined) {
      const pending = this.lines[this.pendingAssistantIndex];
      if (pending?.role === 'assistant') pending.content = message.content;
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
    if (pending?.role === 'reasoning') pending.content += content;
  }

  appendReasoningMessage(message: Message): void {
    if (this.pendingReasoningIndex !== undefined) {
      const pending = this.lines[this.pendingReasoningIndex];
      if (pending?.role === 'reasoning') pending.content = message.content;
      this.pendingReasoningIndex = undefined;
      return;
    }
    const insertAt = this.pendingAssistantIndex ?? this.lines.length;
    this.lines.splice(insertAt, 0, { role: 'reasoning', content: message.content, closed: !this.thinkingVisible });
    if (this.pendingAssistantIndex !== undefined) this.pendingAssistantIndex++;
  }

  appendToolCall(call: Extract<CoreEvent, { type: 'tool_call' }>['call']): void {
    this.lines.push({
      role: 'tool',
      callId: call.id,
      name: call.tool,
      argsPreview: formatToolCallArgs(call.tool, call.args),
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
      ? createQueuedUserLine(message, queue)
      : this.visibleQueuedLines.splice(visibleIndex, 1)[0].line;

    this.lines.push(line);
    this.queuedUserLines.push(line);
  }

  appendVisibleQueuedMessage(message: Message, queue: 'steering' | 'follow_up'): void {
    if (this.visibleQueuedLines.some((entry) => entry.message === message)) return;
    this.visibleQueuedLines.push({ message, queue, line: createQueuedUserLine(message, queue) });
  }

  activateNextQueuedUserMessage(): void {
    const line = this.queuedUserLines.shift();
    if (line) delete line.label;
  }

  toggleThinking(): void {
    this.thinkingVisible = !this.thinkingVisible;
    for (const entry of this.lines) {
      if (entry.role === 'reasoning') entry.closed = !this.thinkingVisible;
    }
  }

  openThinkingLine(line: Extract<ChatLine, { role: 'reasoning' }>): void {
    if (!line.closed) return;
    line.closed = false;
  }
}

function createQueuedUserLine(message: Message, queue: 'steering' | 'follow_up'): UserChatLine {
  return {
    role: 'user',
    content: message.content,
    label: queue === 'steering' ? 'queued steering' : 'follow-up',
  };
}
