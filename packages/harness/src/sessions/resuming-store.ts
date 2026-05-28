/**
 * Wrap a `PersistedSessionStore` so the first `create()` call returns an
 * existing session id rather than allocating a new one.
 *
 * `AgentRuntime` calls `store.create()` at construction time. Hosts that
 * want to resume the latest session would otherwise have to choose between
 * orphaning a fresh empty session or rebuilding the runtime after the fact.
 * Wrapping the store hijacks that first allocation: if `resumeId` resolves
 * to an existing session, it's returned; otherwise we fall through to a
 * normal `create()`.
 */
import type { Session, SessionInit } from 'mu-core';
import type { PersistedSessionStore } from './types';

export function createResumingStore(
  inner: PersistedSessionStore,
  resumeId: string,
): PersistedSessionStore {
  let consumed = false;
  return {
    ...inner,
    create(init?: SessionInit): Session {
      if (!consumed) {
        consumed = true;
        const existing = inner.get(resumeId);
        if (existing) return existing;
      }
      return inner.create(init);
    },
  };
}
