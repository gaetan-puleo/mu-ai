import type { CoreEvent, EventBus, SessionStore, Unsubscribe } from 'mu-core';

export type StoreChangeKind = 'created' | 'updated' | 'deleted' | 'renamed';

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/**
 * SessionStore augmented with transport-friendly affordances:
 *   - light `summaries()` listing without loading every transcript
 *   - `rename()` to update metadata
 *   - filesystem-level `watch()` (distinct from the core SessionStore subscribe)
 *   - `persistOnBus()` to auto-append events from the runtime bus
 *   - `persistFollowingBus()` to follow the current session as the runtime
 *     switches (e.g. on `/new`) without the host wiring re-subscribes itself
 */
export interface PersistedSessionStore extends SessionStore {
  summaries(): SessionSummary[];
  rename(id: string, title: string): boolean;
  watch(fn: (sessionId: string, kind: StoreChangeKind) => void): Unsubscribe;
  persistOnBus(bus: EventBus<CoreEvent>, sessionId: string): Unsubscribe;
  /**
   * Persist events from `bus` for `initialSessionId`, and rebind automatically
   * whenever the store emits a `created` event. Returns an Unsubscribe that
   * tears down both subscriptions.
   *
   * This is the "follow the active session" pattern: hosts call it once at
   * boot with the runtime's first session id and never have to think about
   * `/new` re-subscriptions.
   */
  persistFollowingBus(bus: EventBus<CoreEvent>, initialSessionId: string): Unsubscribe;
}
