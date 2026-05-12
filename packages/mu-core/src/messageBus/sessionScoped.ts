/**
 * Session-scoped MessageBus.
 *
 * The `MessageBus` interface in `plugin.ts` exposes single-tenant
 * methods (`append(msg)`, etc.) so plugins don't have to thread a
 * sessionId through every call. This module ships the router that
 * makes single-tenant calls route into a per-session buffer:
 *
 *   - `setCurrentSession(id)` pins the bus to a session — used by the
 *     host's turn orchestrator (`runHostTurn`) in a try/finally around
 *     the hook chain so plugins always see the right session.
 *   - `drainNextFor(sessionId)` drains a specific session's
 *     `injectNext` queue. Used by `runHostTurn` before `runTurn` so
 *     queued messages splice into the upcoming transcript without the
 *     plugin needing to know about session ids.
 *   - `onSyntheticAppend(sessionId, message)` is the host's fan-out
 *     callback for `bus.append(msg)` — typically a WebSocket push for
 *     channel hosts.
 *
 * Replaces arya's old `arya/message-bus.ts` router (which lived in the
 * host because mu-core's contract was registry-scoped). Now mu-core
 * owns the routing and every multi-session host gets it for free.
 */

import type { MessageBus } from '../plugin';
import type { Session } from '../session';
import type { ChatMessage } from '../types/llm';

export interface MessageBusRouter extends MessageBus {
  /**
   * Pin all subsequent `append`/`injectNext`/`drainNext`/`subscribe`/
   * `get` calls to this session's buffer. Pass `null` to unpin.
   *
   * `runHostTurn` calls this automatically — host code shouldn't need
   * to call it directly unless it runs plugin hooks outside the
   * canonical turn flow.
   */
  setCurrentSession: (sessionId: string | null) => void;
  /** Per-session drain. Used by `runHostTurn` regardless of pin. */
  drainNextFor: (sessionId: string) => ChatMessage[];
  /** Read a specific session's appended snapshot (host-only, rare). */
  snapshot: (sessionId: string) => ChatMessage[];
}

export interface CreateSessionScopedMessageBusOptions {
  /**
   * Resolve a session by id so `bus.append(msg)` can mirror the
   * synthetic message into the session's transcript via
   * `session.appendSynthetic`.
   */
  resolveSession: (id: string) => Session | undefined;
  /**
   * Host-side fan-out for synthetic appends. Channel hosts (arya WS)
   * push these over the wire so clients see synthetic messages live.
   */
  onSyntheticAppend?: (sessionId: string, message: ChatMessage) => void;
}

interface PerSession {
  appended: ChatMessage[];
  injected: ChatMessage[];
  subscribers: Set<(msgs: ChatMessage[]) => void>;
}

function emptyPerSession(): PerSession {
  return { appended: [], injected: [], subscribers: new Set() };
}

export function createSessionScopedMessageBus(
  opts: CreateSessionScopedMessageBusOptions,
): MessageBusRouter {
  const bySession = new Map<string, PerSession>();
  let currentSessionId: string | null = null;

  function getOrInit(id: string): PerSession {
    let entry = bySession.get(id);
    if (!entry) {
      entry = emptyPerSession();
      bySession.set(id, entry);
    }
    return entry;
  }

  function fireSubscribers(entry: PerSession): void {
    const snapshot = entry.appended.slice();
    for (const fn of entry.subscribers) {
      try {
        fn(snapshot);
      } catch {
        // listener errors must not break the bus
      }
    }
  }

  return {
    append(message) {
      if (!currentSessionId) return;
      const entry = getOrInit(currentSessionId);
      entry.appended.push(message);
      fireSubscribers(entry);
      // Mirror the synthetic message into the session transcript so
      // mu-core's agent loop preserves it across turns.
      const session = opts.resolveSession(currentSessionId);
      session?.appendSynthetic(message);
      opts.onSyntheticAppend?.(currentSessionId, message);
    },

    injectNext(message) {
      if (!currentSessionId) return;
      getOrInit(currentSessionId).injected.push(message);
    },

    drainNext() {
      if (!currentSessionId) return [];
      const entry = bySession.get(currentSessionId);
      if (!entry) return [];
      const out = entry.injected.slice();
      entry.injected.length = 0;
      return out;
    },

    subscribe(listener) {
      if (!currentSessionId) {
        return () => undefined;
      }
      const entry = getOrInit(currentSessionId);
      entry.subscribers.add(listener);
      listener(entry.appended.slice());
      return () => entry.subscribers.delete(listener);
    },

    get() {
      if (!currentSessionId) return [];
      return bySession.get(currentSessionId)?.appended.slice() ?? [];
    },

    setCurrentSession(id) {
      currentSessionId = id;
    },

    drainNextFor(id) {
      const entry = bySession.get(id);
      if (!entry) return [];
      const out = entry.injected.slice();
      entry.injected.length = 0;
      return out;
    },

    snapshot(id) {
      return bySession.get(id)?.appended.slice() ?? [];
    },
  };
}
