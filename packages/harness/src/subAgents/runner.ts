import type { Agent } from '../agents';
import type { AgentSession } from '../session';
import type { SubAgentRegistry, SubAgentResult } from './types';

export interface RunSubAgentDeps {
  spawn(agent: Agent): AgentSession;
  runs?: SubAgentRegistry;
  parentId?: string;
  runId?: string;
  signal?: AbortSignal;
}

const finalText = (session: AgentSession): string => {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i];
    if (message.role === 'assistant') {
      return message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
    }
  }
  return '';
};

export const runSubAgent = async (agent: Agent, task: string, deps: RunSubAgentDeps): Promise<SubAgentResult> => {
  const session = deps.spawn(agent);
  deps.runs?.register({ runId: deps.runId ?? session.id, agent: agent.name, parentId: deps.parentId, session });
  const { signal } = deps;
  if (signal?.aborted) session.abort();
  const onAbort = () => session.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let failure: unknown;
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'error') failure = event.error;
  });
  try {
    await session.send(task);
  } finally {
    unsubscribe();
    signal?.removeEventListener('abort', onAbort);
  }
  if (failure !== undefined) throw failure instanceof Error ? failure : new Error(String(failure));
  return { agent: agent.name, text: finalText(session) };
};
