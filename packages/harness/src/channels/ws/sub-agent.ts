import type { Message } from 'mu-core';
import type { AgentSession } from '../../session';
import { argsToString, textOf, toolResultText } from './wire';
import type { SubAgentEventWire, WsOutbound } from './protocol';

export interface SubAgentMeta {
  runId: string;
  agentName: string;
  parentSessionId: string;
}

const lastAssistantText = (messages: readonly Message[]): string => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return textOf(messages[i].content);
  }
  return '';
};

export function observeSubAgent(
  session: AgentSession,
  meta: SubAgentMeta,
  broadcast: (frame: WsOutbound) => void,
): void {
  const toolNames = new Map<string, string>();
  const { runId, agentName, parentSessionId } = meta;
  const emit = (event: SubAgentEventWire): void => broadcast({ type: 'sub_agent_event', event });

  const unsubscribe = session.subscribe((ev) => {
    switch (ev.type) {
      case 'turn_start':
        emit({ runId, parentSessionId, agentName, type: 'started', detail: { task: textOf(ev.input.content) } });
        return;
      case 'text':
        emit({ runId, parentSessionId, agentName, type: 'content', detail: ev.text });
        return;
      case 'tool_call':
        toolNames.set(ev.id, ev.name);
        emit({
          runId,
          parentSessionId,
          agentName,
          type: 'tool_call',
          detail: { name: ev.name, arguments: argsToString(ev.input) },
        });
        return;
      case 'message': {
        if (ev.message.role !== 'user') return;
        for (const part of ev.message.content) {
          if (part.type !== 'tool_result') continue;
          const content = toolResultText(part.content);
          emit({
            runId,
            parentSessionId,
            agentName,
            type: 'tool_result',
            detail: { name: toolNames.get(part.id) ?? '', content, error: /^Error:/.test(content) },
          });
        }
        return;
      }
      case 'turn_end':
        emit({
          runId,
          parentSessionId,
          agentName,
          type: 'completed',
          detail: { content: lastAssistantText(session.messages) },
        });
        unsubscribe();
        return;
      case 'error':
        emit({
          runId,
          parentSessionId,
          agentName,
          type: 'error',
          detail: ev.error instanceof Error ? ev.error.message : String(ev.error),
        });
        unsubscribe();
        return;
      default:
        return;
    }
  });
}
