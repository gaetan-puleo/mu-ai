/**
 * Auto-persist a `Session`'s transcript into a `SessionStore`.
 *
 * Subscribes to session events and writes the streamed assistant content
 * + tool messages into the store as the agent loop progresses:
 *
 *  - `stream_partial`  → buffer cumulative assistant text per session.
 *  - `messages_changed` → snapshot the message graph so the next
 *    `stream_ended` can diff new tool messages from a high-water cursor.
 *  - `stream_ended`     → persist any new tool messages (since the
 *    previous cursor) AND the final assistant text. Cursor advances.
 *  - `error`            → drop the buffer (no half-streamed assistant
 *    lands on disk).
 *
 * Per-session cursor lives inside the closure — one cursor per session,
 * not per subscriber. Multiple `attachAutoPersist(...)` calls for the
 * same session are idempotent: the second call is a no-op (the first
 * persistence path wins).
 *
 * Generic across hosts: arya wires this up at boot via
 * `sessions.onSessionCreated`; mu-coding uses it from its session
 * persistence hook. Each pass their own `getActiveAgent` so the
 * persisted assistant message carries the canonical `meta.agent` key.
 */

import { makeAssistantMessage, makeToolMessage } from '../messageFactories';
import type { Session } from '../session';
import type { ChatMessage } from '../types/llm';
import type { SessionStore } from './types';

export interface AutoPersistOptions {
  /** Returns the agent name to stamp on assistant messages persisted here. */
  getActiveAgent?: () => string | undefined;
  /** Optional logger; defaults to no-op. */
  onError?: (where: string, err: unknown) => void;
}

/** Tracks active attachments so a second call for the same session is a no-op. */
const ATTACHED = new WeakSet<Session>();

interface PersistState {
  pendingAssistant: string;
  latestMessages: ChatMessage[];
  persistedMessageCount: number;
}

function emptyState(): PersistState {
  return { pendingAssistant: '', latestMessages: [], persistedMessageCount: 0 };
}

/**
 * Attach the persister. Returns an unsubscribe function; calling it
 * unhooks the listener but does NOT delete persisted data.
 *
 * Idempotent per session: re-attaching to the same session returns a
 * no-op unsubscribe (the first attach stays in charge).
 */
export function attachAutoPersist(
  session: Session,
  store: SessionStore,
  opts: AutoPersistOptions = {},
): () => void {
  if (ATTACHED.has(session)) {
    return () => {
      // No-op — the first attach owns persistence for this session.
    };
  }
  ATTACHED.add(session);

  const sessionId = session.id;
  const state = emptyState();
  const onError =
    opts.onError ??
    ((): void => {
      // default sink: drop errors
    });

  const persistTools = (): void => {
    const snapshot = state.latestMessages;
    const cursor = state.persistedMessageCount;
    const tools = snapshot
      .slice(cursor)
      .filter((m) => m.role === 'tool' && m.toolResult);
    for (const t of tools) {
      try {
        store.appendMessage(
          sessionId,
          makeToolMessage({
            toolCallId: t.toolCallId,
            toolName: t.toolResult?.name ?? 'tool',
            // Re-parse stored args string if present so the factory
            // gets an object (factories pretty-print themselves).
            toolArgs: t.toolCallArgs as Record<string, unknown> | undefined,
            toolResult: t.toolResult?.content ?? t.content ?? '',
            toolError: t.toolResult?.error === true,
          }),
        );
      } catch (err) {
        onError('persist-tool', err);
      }
    }
    state.persistedMessageCount = snapshot.length;
  };

  const persistAssistant = (): void => {
    const finalText = state.pendingAssistant;
    state.pendingAssistant = '';
    if (!finalText.trim()) return;
    try {
      store.appendMessage(
        sessionId,
        makeAssistantMessage(finalText, {
          agent: opts.getActiveAgent?.() ?? undefined,
        }),
      );
    } catch (err) {
      onError('persist-assistant', err);
    }
  };

  const off = session.subscribe((event) => {
    if (event.type === 'stream_partial') {
      state.pendingAssistant = event.text;
      return;
    }
    if (event.type === 'messages_changed') {
      state.latestMessages = event.messages;
      return;
    }
    if (event.type === 'stream_ended') {
      persistTools();
      persistAssistant();
      return;
    }
    if (event.type === 'error') {
      state.pendingAssistant = '';
    }
  });

  return () => {
    off();
    ATTACHED.delete(session);
  };
}
