import type { SubAgentRegistry, SubAgentRun } from './types';

export const createSubAgentRegistry = (): SubAgentRegistry => {
  const runs = new Map<string, SubAgentRun>();
  const listeners = new Set<(run: SubAgentRun) => void>();
  return {
    register: (run) => {
      runs.set(run.runId, run);
      for (const listener of listeners) listener(run);
    },
    get: (runId) => runs.get(runId),
    list: () => [...runs.values()],
    byParent: (parentId) => [...runs.values()].filter((run) => run.parentId === parentId),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
