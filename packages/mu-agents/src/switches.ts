import { nowMs } from 'mu-core';

export type SwitchReason = 'mention' | 'mention-revert' | 'programmatic' | 'default';

export interface SwitchEvent {
  sessionId: string;
  from: string | undefined;
  to: string;
  reason: SwitchReason;
  ts: number;
}

export interface SwitchTracker {
  log(event: Omit<SwitchEvent, 'ts'>): SwitchEvent;
  history(sessionId: string): readonly SwitchEvent[];
  subscribe(fn: (event: SwitchEvent) => void): () => void;
  clearSession(sessionId: string): void;
}

export function createSwitchTracker(): SwitchTracker {
  const byId = new Map<string, SwitchEvent[]>();
  const listeners = new Set<(event: SwitchEvent) => void>();

  return {
    log(event) {
      const full: SwitchEvent = { ...event, ts: nowMs() };
      const list = byId.get(event.sessionId);
      if (list) list.push(full);
      else byId.set(event.sessionId, [full]);
      for (const fn of listeners) {
        try {
          fn(full);
        } catch {
          /* listener errors don't break tracking */
        }
      }
      return full;
    },
    history(sessionId) {
      return byId.get(sessionId) ?? [];
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    clearSession(sessionId) {
      byId.delete(sessionId);
    },
  };
}
