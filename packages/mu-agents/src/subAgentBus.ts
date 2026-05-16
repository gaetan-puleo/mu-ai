export type SubAgentEventType = 'started' | 'content' | 'tool_call' | 'tool_result' | 'completed' | 'error';

export interface SubAgentEvent {
  runId: string;
  parentSessionId: string;
  agentName: string;
  type: SubAgentEventType;
  detail?: unknown;
}

export interface SubAgentBus {
  emit(event: SubAgentEvent): void;
  /** Subscribe to events for sub-runs of a specific parent session. */
  onParent(parentSessionId: string, fn: (event: SubAgentEvent) => void): () => void;
  /** Drop all listeners. Used during plugin deactivate. */
  clear(): void;
}

export function createSubAgentBus(): SubAgentBus {
  const byParent = new Map<string, Set<(event: SubAgentEvent) => void>>();

  return {
    emit(event) {
      const listeners = byParent.get(event.parentSessionId);
      if (!listeners) return;
      for (const fn of listeners) {
        try {
          fn(event);
        } catch {
          /* listener errors must not break the run */
        }
      }
    },
    onParent(parentSessionId, fn) {
      let set = byParent.get(parentSessionId);
      if (!set) {
        set = new Set();
        byParent.set(parentSessionId, set);
      }
      set.add(fn);
      return () => {
        set?.delete(fn);
        if (set && set.size === 0) byParent.delete(parentSessionId);
      };
    },
    clear() {
      byParent.clear();
    },
  };
}
