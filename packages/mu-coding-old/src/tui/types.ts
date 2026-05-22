import type { Message } from 'mu-core';
import { formatToolCallArgs, formatToolResultPreview } from './transcript';

export interface MessageRow {
  kind: 'message';
  id: string;
  role: Message['role'];
  content: string;
  reasoning?: string;
  agentColor?: string;
}

export interface ToolCallRow {
  kind: 'tool_call';
  id: string;
  callId?: string;
  name: string;
  argsPreview: string;
}

export interface ToolResultRow {
  kind: 'tool_result';
  id: string;
  callId?: string;
  name: string;
  preview: string;
  error: boolean;
}

export type TranscriptRow = MessageRow | ToolCallRow | ToolResultRow;

export function messageRowFromMessage(message: Message): MessageRow | null {
  if (!(message.content || message.reasoning)) return null;
  return {
    kind: 'message',
    id: message.id,
    role: message.role,
    content: message.content,
    reasoning: message.reasoning,
  };
}

export function toolCallRowsFromMessage(message: Message): ToolCallRow[] {
  if (!message.toolCalls || message.toolCalls.length === 0) return [];
  const out: ToolCallRow[] = [];
  for (const tc of message.toolCalls) {
    out.push({
      kind: 'tool_call',
      id: `${message.id}::${tc.id}`,
      callId: tc.id,
      name: tc.function.name,
      argsPreview: formatToolCallArgs(tc.function.arguments),
    });
  }
  return out;
}

export function toolResultRowFromMessage(message: Message): ToolResultRow | null {
  const r = message.toolResult;
  if (!r) return null;
  return {
    kind: 'tool_result',
    id: message.id,
    callId: message.toolCallId,
    name: r.name,
    preview: formatToolResultPreview(r.content),
    error: r.error === true,
  };
}

export function insertToolResultRow(rows: TranscriptRow[], result: ToolResultRow): TranscriptRow[] {
  if (rows.some((row) => row.id === result.id)) return rows;
  if (!result.callId) return [...rows, result];
  const callIndex = rows.findIndex((row) => row.kind === 'tool_call' && row.callId === result.callId);
  if (callIndex < 0) return [...rows, result];
  return [...rows.slice(0, callIndex + 1), result, ...rows.slice(callIndex + 1)];
}
