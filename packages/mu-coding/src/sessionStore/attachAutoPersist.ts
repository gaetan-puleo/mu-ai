import { existsSync } from 'node:fs';
import { debugLog, type Session } from 'mu-core';
import { appendMessage, readSessionHeader, type SessionHeader, writeHeader } from './jsonl';

export interface AutoPersistOptions {
  /** Header to write. `kind` and `version` are filled in automatically. */
  header: Omit<SessionHeader, 'kind' | 'version'>;
  /** Where to write the file. Caller picks the path so resume can re-use it. */
  filePath: string;
  /**
   * When true, the file must already exist and contain a header whose id
   * matches `header.id`. The existing header is validated and the new one
   * is not written.
   *
   * When false (default), the file must NOT exist; the header is written.
   */
  resumeExisting?: boolean;
}

/**
 * Subscribe to a session and persist every appended (non-transient) message
 * to a JSONL file. Returns an unsubscribe function.
 *
 * Failure modes:
 *   - writing the header fails → rejects; the caller decides what to do
 *     (mu-coding logs a warning and continues in-memory only).
 *   - appending a message fails → swallowed + logged. We never break the
 *     live session because of a disk hiccup.
 *
 * The `transcript_cleared` event is deliberately ignored — the on-disk
 * history is the source of truth, and `Session.clear()` is a UI-level
 * action (mu-coding doesn't call it anymore, but this guard keeps the
 * store correct if a future plugin does).
 */
export async function attachAutoPersist(session: Session, opts: AutoPersistOptions): Promise<() => void> {
  const fullHeader: SessionHeader = { kind: 'header', version: 1, ...opts.header };

  if (opts.resumeExisting) {
    if (!existsSync(opts.filePath)) {
      throw new Error(`cannot resume: session file not found at ${opts.filePath}`);
    }
    const existing = await readSessionHeader(opts.filePath);
    if (existing.id !== fullHeader.id) {
      throw new Error(`session id mismatch on resume: file=${existing.id} expected=${fullHeader.id}`);
    }
  } else {
    await writeHeader(opts.filePath, fullHeader);
  }

  const off = session.on((ev) => {
    if (ev.type !== 'message_appended') return;
    if (ev.message.meta?.transient === true) return;
    void appendMessage(opts.filePath, ev.message).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      debugLog('persist', 'append.error', { sessionId: session.id, error: msg });
    });
  });

  return off;
}
