/**
 * Project a mu-core `ChatMessage` into a flat, render-ready row.
 *
 * Every host (TUI, WebSocket companion, future Telegram, web) consumes
 * the same canonical shape. Eliminates the per-channel wire→display
 * conversion that used to live in arya-companion's `sessionWire.ts`.
 *
 *  - `content` → `text` (tool messages strip content; the structured
 *    `toolResult.content` carries the body).
 *  - `toolResult.name/content/error` → `toolName/toolResult/toolError`.
 *  - `meta.agent` → `agent`.
 *  - `meta.id` / `meta.ts` → row id / timestamp; synthesised when
 *    missing so legacy / minimal messages still render.
 *  - `toolCallArgs` → pretty-printed JSON into `toolArgs`.
 *  - `display.badge` / `display.color` / `display.hidden` /
 *    `display.llmHidden` surface as flat fields the renderer can read.
 */

import type { ChatMessage } from './types/llm';

export interface MessageDisplayRow {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  ts: number;
  /** Agent name (resolved from `meta.agent`). */
  agent?: string;
  reasoning?: string;
  toolName?: string;
  toolArgs?: string;
  toolResult?: string;
  toolError?: boolean;
  badge?: string;
  color?: string;
  customType?: string;
  hidden?: boolean;
  llmHidden?: boolean;
}

/**
 * Project a single `ChatMessage` to a `MessageDisplayRow`.
 *
 * @param indexHint optional positional hint used to synthesise an id
 *                  when `meta.id` is missing (e.g. legacy transcripts).
 */
export function projectMessage(msg: ChatMessage, indexHint?: number): MessageDisplayRow {
  // `system` messages are kept out of the visible transcript by hosts;
  // be defensive and project them as assistant rows.
  const role: MessageDisplayRow['role'] = msg.role === 'system' ? 'assistant' : msg.role;
  const text = msg.role === 'tool' ? '' : msg.content;

  const meta = msg.meta;
  const id = meta?.id ?? msg.toolCallId ?? `m-${indexHint ?? 0}`;
  const ts = meta?.ts ?? 0;
  const agent = meta?.agent;

  const metaToolArgs = meta?.toolArgs;
  const toolArgs = metaToolArgs ?? (msg.toolCallArgs ? JSON.stringify(msg.toolCallArgs, null, 2) : undefined);

  const row: MessageDisplayRow = {
    id,
    role,
    text,
    ts,
  };
  if (agent) row.agent = agent;
  if (msg.reasoning) row.reasoning = msg.reasoning;
  if (msg.toolResult) {
    row.toolName = msg.toolResult.name;
    row.toolResult = msg.toolResult.content;
    row.toolError = msg.toolResult.error === true;
  }
  if (toolArgs) row.toolArgs = toolArgs;
  if (msg.display?.badge) row.badge = msg.display.badge;
  if (msg.display?.color) row.color = msg.display.color;
  if (msg.customType) row.customType = msg.customType;
  if (msg.display?.hidden) row.hidden = true;
  if (msg.display?.llmHidden) row.llmHidden = true;
  return row;
}
