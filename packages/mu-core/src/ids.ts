/**
 * Centralised id + timestamp helpers.
 *
 * Replaces ad-hoc `${Date.now()}-X` and `Math.random().toString(36).slice(2, 8)`
 * snippets. Every id minted by mu (or a mu-consumer like arya) should come
 * from here so formats stay consistent and any future change (e.g. switching
 * to ULIDs) is a one-file edit.
 */

/** Epoch milliseconds — kept as a function for test stubbing. */
export function nowMs(): number {
  return Date.now();
}

/** Short, URL-safe random suffix. ~36 bits, plenty for in-process uniqueness. */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** New persisted-session id (`sess_<ts>_<rand>`). */
export function newSessionId(): string {
  return `sess_${nowMs()}_${randomSuffix()}`;
}

/** New scheduler-session id (`task:<taskId>:<ts>`). */
export function newTaskSessionId(taskId: string): string {
  return `task:${taskId}:${nowMs()}`;
}

/**
 * Per-message id. `role` is condensed to a single letter to keep the id
 * short. Backwards-compatible with arya's pre-mu-core scheme.
 */
export function newMessageId(role: 'user' | 'assistant' | 'tool', toolCallId?: string): string {
  const letter = role === 'user' ? 'u' : role === 'assistant' ? 'a' : 't';
  if (role === 'tool') {
    return `${nowMs()}-t-${toolCallId ?? randomSuffix()}`;
  }
  return `${nowMs()}-${letter}`;
}
