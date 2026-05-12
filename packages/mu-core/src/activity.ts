/**
 * ActivityBus — pub/sub for high-level events emitted by the agent loop
 * and by tools. Hosts subscribe to render timelines (TUI), broadcast to
 * companion websockets, etc.
 *
 * Sub-agent events live in `mu-agents`'s `SubAgentBus` (they're emitted
 * only by mu-agents). The host's sub-agent UI consumes the higher-level
 * `SubagentRunRegistry.subscribeAllSnapshots` instead of the raw event
 * bus.
 */

export type ActivityKind =
  | 'agent_start'
  | 'agent_end'
  | 'tool_start'
  | 'tool_end'
  | 'task_started'
  | 'task_completed'
  | 'task_error';

export interface ActivityEvent {
  id: number;
  ts: number;
  kind: ActivityKind;
  source: string;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface ActivityBus {
  subscribe: (fn: (e: ActivityEvent) => void) => () => void;
  emit: (kind: ActivityKind, source: string, summary: string, detail?: Record<string, unknown>) => void;
}

export function createActivityBus(): ActivityBus {
  let nextId = 1;
  const listeners = new Set<(e: ActivityEvent) => void>();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(kind, source, summary, detail) {
      const event: ActivityEvent = {
        id: nextId++,
        ts: Date.now(),
        kind,
        source,
        summary,
        detail,
      };
      for (const fn of listeners) {
        try {
          fn(event);
        } catch {
          // listeners must not break the bus
        }
      }
    },
  };
}
