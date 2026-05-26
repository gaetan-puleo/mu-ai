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
 */
export interface PersistedSessionStore extends SessionStore {
  summaries(): SessionSummary[];
  rename(id: string, title: string): boolean;
  watch(fn: (sessionId: string, kind: StoreChangeKind) => void): Unsubscribe;
  persistOnBus(bus: EventBus<CoreEvent>, sessionId: string): Unsubscribe;
}
