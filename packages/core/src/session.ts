import type { Unsubscribe } from './bus';
import type { Message } from './types/Message';
import type { Session } from './types/Session';

export type SessionStoreEvent =
  | { type: 'created'; session: Session }
  | { type: 'updated'; session: Session }
  | { type: 'deleted'; sessionId: string };

export interface SessionInit {
  title?: string;
  messages?: Message[];
}

export interface SessionStore {
  list(): Session[];
  get(id: string): Session | undefined;
  create(init?: SessionInit): Session;
  /**
   * Branch from `sourceId` at `atIndex` (inclusive). The fork copies
   * `messages.slice(0, atIndex + 1)`, leaves the source untouched, and gets
   * empty queues and a fresh id. Throws if the source is missing or if the
   * index does not point at a user message.
   */
  fork(sourceId: string, atIndex: number, init?: SessionInit): Session;
  delete(id: string): void;
  /**
   * Bump `updatedAt` and emit an `updated` event. The runtime stays unaware
   * of the store, so callers (typically the host or harness) decide when to
   * touch — e.g. on each `assistant_message` / `tool_result` event.
   */
  touch(id: string): void;
  subscribe(listener: (event: SessionStoreEvent) => void): Unsubscribe;
}

export interface InMemorySessionStoreOptions {
  /** Override id generation (default: `s_${counter}`). */
  idGen?: () => string;
  /** Override timestamp (default: `Date.now()`). Useful for deterministic tests. */
  now?: () => number;
}

export function createInMemorySessionStore(options: InMemorySessionStoreOptions = {}): SessionStore {
  const sessions = new Map<string, Session>();
  const listeners = new Set<(event: SessionStoreEvent) => void>();
  let counter = 0;
  const idGen = options.idGen ?? (() => `s_${++counter}`);
  const now = options.now ?? (() => Date.now());

  function emit(event: SessionStoreEvent): void {
    for (const fn of listeners) {
      try {
        fn(event);
      } catch (err) {
        console.error('[mu-core/session] listener threw:', err);
      }
    }
  }

  return {
    list() {
      return [...sessions.values()];
    },

    get(id) {
      return sessions.get(id);
    },

    create(init = {}) {
      const ts = now();
      const session: Session = {
        id: idGen(),
        title: init.title,
        messages: init.messages ? [...init.messages] : [],
        steeringQueue: [],
        followUpQueue: [],
        createdAt: ts,
        updatedAt: ts,
      };
      sessions.set(session.id, session);
      emit({ type: 'created', session });
      return session;
    },

    fork(sourceId, atIndex, init = {}) {
      const source = sessions.get(sourceId);
      if (!source) {
        throw new Error(`Cannot fork unknown session "${sourceId}"`);
      }
      if (atIndex < 0 || atIndex >= source.messages.length) {
        throw new Error(`Fork index ${atIndex} out of range (0..${source.messages.length - 1})`);
      }
      const pivot = source.messages[atIndex];
      if (pivot.role !== 'user') {
        throw new Error(`Fork point must be a user message; got role "${pivot.role}" at index ${atIndex}`);
      }
      const ts = now();
      const fork: Session = {
        id: idGen(),
        title: init.title,
        messages: source.messages.slice(0, atIndex + 1),
        steeringQueue: [],
        followUpQueue: [],
        createdAt: ts,
        updatedAt: ts,
        forkedFrom: { sessionId: sourceId, atIndex },
      };
      sessions.set(fork.id, fork);
      emit({ type: 'created', session: fork });
      return fork;
    },

    delete(id) {
      if (!sessions.delete(id)) return;
      emit({ type: 'deleted', sessionId: id });
    },

    touch(id) {
      const session = sessions.get(id);
      if (!session) return;
      session.updatedAt = now();
      emit({ type: 'updated', session });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
