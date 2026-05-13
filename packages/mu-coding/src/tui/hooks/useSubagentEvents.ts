import type { AgentsHandle, SubAgentEvent } from 'mu-agents';
import { useEffect, useRef } from 'react';
import { useDispatch } from '../state/AppContext';
import type { SubRunSummary } from '../state/uiStore';

function formatLine(event: SubAgentEvent): string {
  switch (event.type) {
    case 'started':
      return 'started';
    case 'content': {
      const text = typeof event.detail === 'string' ? event.detail : '';
      return `content: ${text.slice(0, 80)}`;
    }
    case 'tool_call': {
      const d = event.detail as { name?: string } | undefined;
      return `→ tool ${d?.name ?? '?'}`;
    }
    case 'tool_result': {
      const d = event.detail as { name?: string; error?: boolean } | undefined;
      return `← tool ${d?.name ?? '?'}${d?.error ? ' (error)' : ''}`;
    }
    case 'completed':
      return 'completed';
    case 'error': {
      const msg = typeof event.detail === 'string' ? event.detail : 'error';
      return `error: ${msg}`;
    }
    default:
      return event.type;
  }
}

export function useSubagentEvents(agents: AgentsHandle | undefined, parentSessionId: string): void {
  const dispatch = useDispatch();
  const runs = useRef<Map<string, SubRunSummary>>(new Map());

  useEffect(() => {
    if (!agents) return;
    runs.current = new Map();

    const off = agents.onSubAgentEvent(parentSessionId, (event) => {
      const line = formatLine(event);
      const now = Date.now();

      let run = runs.current.get(event.runId);
      if (event.type === 'started') {
        const detail = event.detail as { task?: string } | undefined;
        run = {
          runId: event.runId,
          agentName: event.agentName,
          task: detail?.task ?? '',
          status: 'running',
          startedAt: now,
          events: [line],
        };
      } else if (run) {
        run = { ...run, events: [...run.events, line] };
        if (event.type === 'completed') run = { ...run, status: 'completed', endedAt: now };
        if (event.type === 'error') run = { ...run, status: 'error', endedAt: now };
      } else {
        // Defensive: events arriving before 'started' — synthesise a stub.
        run = {
          runId: event.runId,
          agentName: event.agentName,
          task: '',
          status: 'running',
          startedAt: now,
          events: [line],
        };
      }
      runs.current.set(event.runId, run);
      dispatch({ type: 'subrun_upsert', run });
    });

    return off;
  }, [agents, parentSessionId, dispatch]);
}
