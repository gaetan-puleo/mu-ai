import type { Message } from 'mu-core';
import {
  insertToolResultRow,
  messageRowFromMessage,
  type TranscriptRow,
  toolCallRowsFromMessage,
  toolResultRowFromMessage,
} from '../tui/types';

export function shouldIncludeMessage(m: Message): boolean {
  if (m.meta?.transient === true) return false;
  if (m.meta?.visibility === 'ui') return false;
  return true;
}

export function rowsFromAppendedMessage(m: Message): TranscriptRow[] {
  if (!shouldIncludeMessage(m)) return [];

  if (m.role === 'system') {
    const row = messageRowFromMessage(m);
    return row ? [row] : [];
  }

  if (m.role === 'tool') {
    const r = toolResultRowFromMessage(m);
    return r ? [r] : [];
  }

  return [];
}

export function rowsFromAssistantMessage(m: Message): TranscriptRow[] {
  const additions: TranscriptRow[] = [];
  if (m.content || m.reasoning) {
    additions.push({
      kind: 'message',
      id: m.id,
      role: 'assistant',
      content: m.content,
      reasoning: m.reasoning,
    });
  }
  for (const row of toolCallRowsFromMessage(m)) {
    additions.push(row);
  }
  return additions;
}

export function rowsFromResumedMessages(messages: readonly Message[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  for (const m of messages) {
    if (m.meta?.transient === true) continue;
    if (m.meta?.visibility === 'ui') continue;
    if (m.role === 'tool') {
      const r = toolResultRowFromMessage(m);
      if (r) rows.splice(0, rows.length, ...insertToolResultRow(rows, r));
      continue;
    }
    const messageRow = messageRowFromMessage(m);
    if (messageRow) rows.push(messageRow);
    if (m.role === 'assistant') {
      for (const tc of toolCallRowsFromMessage(m)) rows.push(tc);
    }
  }
  return rows;
}
