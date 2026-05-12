/**
 * Auto-persist a `Session`'s transcript into a `SessionStore`.
 *
 * Uses exact transcript saves: on `stream_ended`, the full
 * `session.getMessages()` array is written to the store via
 * `store.saveTranscript()`. No reconstruction, no diffing, no
 * cursor-based partial writes.
 *
 * - `stream_ended`        → save exact transcript.
 * - `synthetic_appended`  → save exact transcript (unless transient).
 * - `error`               → no-op (partial state not persisted).
 *
 * Idempotent per session: re-attaching returns a no-op unsubscribe.
 */

import type { Session } from '../session';
import type { SessionStore } from './types';

export interface AutoPersistOptions {
  /** Optional logger; defaults to no-op. */
  onError?: (where: string, err: unknown) => void;
}

/** Tracks active attachments so a second call for the same session is a no-op. */
const ATTACHED = new WeakSet<Session>();

/**
 * Attach the persister. Returns an unsubscribe function; calling it
 * unhooks the listener but does NOT delete persisted data.
 *
 * Idempotent per session: re-attaching to the same session returns a
 * no-op unsubscribe (the first attach stays in charge).
 */
export function attachAutoPersist(session: Session, store: SessionStore, opts: AutoPersistOptions = {}): () => void {
  if (ATTACHED.has(session)) {
    return () => {
      // No-op — the first attach owns persistence for this session.
    };
  }
  ATTACHED.add(session);

  const sessionId = session.id;
  const onError =
    opts.onError ??
    ((): void => {
      // default sink: drop errors
    });

  function saveExact(): void {
    try {
      const messages = session.getMessages();
      if (messages.length === 0) return;
      store.saveTranscript(sessionId, messages);
    } catch (err) {
      onError('save-transcript', err);
    }
  }

  const off = session.subscribe((event) => {
    if (event.type === 'stream_ended') {
      saveExact();
      return;
    }
    if (event.type === 'synthetic_appended') {
      if (event.message.meta?.transient === true) return;
      saveExact();
      return;
    }
  });

  return () => {
    off();
    ATTACHED.delete(session);
  };
}
