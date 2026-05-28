/**
 * Input-history state machine for terminal chat hosts.
 *
 *   ↑  recall older entry
 *   ↓  recall newer entry, eventually restoring the user's in-progress draft
 *
 * The draft is the unsubmitted text typed BEFORE the user pressed `↑` — it's
 * stashed once and restored if they walk all the way back. The "we're
 * navigating" flag exists so a render that sets the input value during a
 * navigation doesn't reset the cursor.
 *
 * Pure state — no IO. The host wires it to a real input widget by calling
 * `setText` in `view()` and feeding the result back into the widget.
 */
export interface InputHistory {
  /** Number of stored entries. */
  size(): number;
  /** Append `text` (dedupes against the most-recent entry); clears cursor + draft. */
  push(text: string, currentDraft?: string): void;
  /**
   * Walk one step in `direction`. Returns `undefined` when there's nothing to
   * show (e.g. at the bottom already, or empty history). Otherwise returns the
   * text that should be shown in the input and a flag indicating whether this
   * is the restored draft (vs. a recalled entry).
   */
  navigate(currentDraft: string, direction: 'up' | 'down'): { text: string; isDraft: boolean } | undefined;
  /**
   * Should be called when the input value changes for ANY reason other than
   * the host's own history navigation. Clears the cursor + draft so the next
   * `↑` starts a fresh walk from the new text.
   */
  resetIfStale(): void;
  /**
   * Wraps a host operation that mutates the input value. Sets a "navigating"
   * latch around the callback so `resetIfStale()` calls inside it become
   * no-ops — useful when the host has a single `setValue` path that always
   * pings the change listener.
   */
  withNavigation<T>(fn: () => T): T;
  /** True when the cursor is parked on a recalled entry (i.e. not on the draft). */
  hasActiveCursor(): boolean;
}

export interface CreateInputHistoryOptions {
  /** Initial entries — typically `loadHistory()` from disk. */
  initial?: readonly string[];
  /**
   * Called with every appended entry. Use this to persist new entries through
   * a `HistoryStore` (`createHistoryStore`); the in-memory ring stays in sync
   * either way.
   */
  onAppend?: (text: string) => void;
}

export function createInputHistory(opts: CreateInputHistoryOptions = {}): InputHistory {
  const entries: string[] = opts.initial ? [...opts.initial] : [];
  /** -1 means "on the user's draft"; otherwise an index into `entries`. */
  let cursor = -1;
  let draft = '';
  let navigating = false;

  return {
    size: () => entries.length,
    hasActiveCursor: () => cursor !== -1,
    push(text, currentDraft) {
      if (entries[entries.length - 1] !== text) {
        entries.push(text);
      }
      cursor = -1;
      draft = currentDraft ?? '';
      opts.onAppend?.(text);
    },
    navigate(currentDraft, direction) {
      if (entries.length === 0) return undefined;
      if (cursor === -1 && direction === 'down') return undefined;

      if (cursor === -1) {
        draft = currentDraft;
        cursor = entries.length - 1;
      } else if (direction === 'up') {
        if (cursor <= 0) {
          return { text: entries[0], isDraft: false };
        }
        cursor--;
      } else {
        cursor++;
        if (cursor >= entries.length) {
          cursor = -1;
          return { text: draft, isDraft: true };
        }
      }
      return { text: entries[cursor], isDraft: false };
    },
    resetIfStale() {
      if (navigating) return;
      if (cursor === -1) return;
      cursor = -1;
      draft = '';
    },
    withNavigation(fn) {
      const previous = navigating;
      navigating = true;
      try {
        return fn();
      } finally {
        navigating = previous;
      }
    },
  };
}
