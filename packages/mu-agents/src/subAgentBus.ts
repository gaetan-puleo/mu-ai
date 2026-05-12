/**
 * SubAgentBus — pub/sub for fine-grained sub-agent invocation events.
 *
 * Only mu-agents emits these (every other event type lives on
 * `mu-core`'s `ActivityBus`). Moving the type + bus here removes a
 * leak in `mu-core` where it declared events nobody in the core
 * actually emits.
 *
 * The host (arya, future channels) doesn't subscribe to this directly
 * anymore — instead it subscribes to the higher-level
 * `SubagentRunRegistry.subscribeAllSnapshots`, which projects to a
 * render-ready wire shape. The raw event bus is kept for plugins that
 * want to react to invocation-level events (telemetry, custom UI).
 */

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

export interface SubAgentBus {
  subscribe: (fn: (e: SubAgentEvent) => void) => () => void;
  emit: (e: SubAgentEvent) => void;
}

export function createSubAgentBus(): SubAgentBus {
  const listeners = new Set<(e: SubAgentEvent) => void>();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(e) {
      for (const fn of listeners) {
        try {
          fn(e);
        } catch {
          // Listener errors must not break the bus.
        }
      }
    },
  };
}
