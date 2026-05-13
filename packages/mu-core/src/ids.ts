/**
 * Id + timestamp helpers. Centralised so format changes are one-file edits.
 */

/** Epoch milliseconds — wrapped for test stubbing. */
export function nowMs(): number {
  return Date.now();
}

/** Short URL-safe random suffix (~36 bits). */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Generic id: `<prefix>_<ts>_<rand>`. */
export function newId(prefix: string): string {
  return `${prefix}_${nowMs()}_${randomSuffix()}`;
}

/** Persisted-session id (`sess_<ts>_<rand>`). */
export function newSessionId(): string {
  return newId('sess');
}

/** Scheduler-session id (`task:<taskId>:<ts>`). */
export function newTaskSessionId(taskId: string): string {
  return `task:${taskId}:${nowMs()}`;
}

/**
 * Per-message id. `role` is condensed to a single letter to keep the id
 * short. Tool messages append the `toolCallId` for traceability.
 */
export function newMessageId(role: 'user' | 'assistant' | 'tool' | 'system', toolCallId?: string): string {
  const letter = role === 'user' ? 'u' : role === 'assistant' ? 'a' : role === 'tool' ? 't' : 's';
  if (role === 'tool') {
    return `${nowMs()}-t-${toolCallId ?? randomSuffix()}`;
  }
  return `${nowMs()}-${letter}`;
}
