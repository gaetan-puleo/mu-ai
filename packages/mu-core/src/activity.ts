/**
 * ActivityBus — pub/sub for high-level events emitted by the agent loop and
 * by tools. Hosts subscribe to render timelines (TUI), broadcast to
 * companion websockets, etc. Independent of the session message store —
 * messages_changed is on Session, ActivityBus is for sidebar/observability.
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

export type SubAgentEventKind =
  | 'invocation_start'
  | 'text_delta'
  | 'message_end'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'invocation_end';

export interface SubAgentEvent {
  runId: string;
  parentRunId?: string;
  agentId: string;
  kind: SubAgentEventKind;
  ts: number;
  data: Record<string, unknown>;
}

export interface ActivityBus {
  subscribe: (fn: (e: ActivityEvent) => void) => () => void;
  emit: (kind: ActivityKind, source: string, summary: string, detail?: Record<string, unknown>) => void;
  subscribeSubAgent: (fn: (e: SubAgentEvent) => void) => () => void;
  emitSubAgent: (e: SubAgentEvent) => void;
}

export function createActivityBus(): ActivityBus {
  let nextId = 1;
  const listeners = new Set<(e: ActivityEvent) => void>();
  const subListeners = new Set<(e: SubAgentEvent) => void>();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(kind, source, summary, detail) {
      const event: ActivityEvent = { id: nextId++, ts: Date.now(), kind, source, summary, detail };
      for (const fn of listeners) {
        try {
          fn(event);
        } catch {
          // listeners must not break the bus
        }
      }
    },
    subscribeSubAgent(fn) {
      subListeners.add(fn);
      return () => subListeners.delete(fn);
    },
    emitSubAgent(e) {
      for (const fn of subListeners) {
        try {
          fn(e);
        } catch {
          // ignore
        }
      }
    },
  };
}
