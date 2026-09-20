import type { AgentSession } from '../session';

export interface SubAgentResult {
  agent: string;
  text: string;
}

export interface SubAgentRun {
  runId: string;
  agent: string;
  parentId?: string;
  session: AgentSession;
}

export interface SubAgentRegistry {
  register(run: SubAgentRun): void;
  get(runId: string): SubAgentRun | undefined;
  list(): SubAgentRun[];
  byParent(parentId: string): SubAgentRun[];
  subscribe(listener: (run: SubAgentRun) => void): () => void;
}
