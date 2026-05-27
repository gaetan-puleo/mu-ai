/**
 * Factory for the bootstrap-time session store.
 *
 * Accepts a `SessionStoreMode` flag, a pre-built `SessionStore` instance, or
 * `undefined` (defaults to jsonl on disk). Pulled out so hosts can swap
 * storage modes without touching the orchestrator.
 */
import { createInMemorySessionStore, type SessionStore } from 'mu-core';
import { createJsonlSessionStore } from '../sessions/jsonl-store';

export type SessionStoreMode = 'jsonl' | 'memory';

/**
 * Resolve the session store from the bootstrap option:
 *   - object → use as-is (custom store).
 *   - `'memory'` → in-memory store.
 *   - `'jsonl'` or `undefined` → jsonl-on-disk under `sessionsDir`.
 */
export function resolveSessionStore(
  mode: SessionStoreMode | SessionStore | undefined,
  sessionsDir: string,
): SessionStore {
  if (typeof mode === 'object' && mode !== null) return mode;
  if (mode === 'memory') return createInMemorySessionStore();
  return createJsonlSessionStore(sessionsDir);
}
