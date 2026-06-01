import type { Tool } from 'mu-core';
import type { AgentSessionHooks } from '../hooks';
import { matchesAnyGlob } from './glob';

export const filterTools = (pool: Tool[], allow: string[] | undefined): Tool[] => {
  const patterns = allow ?? [];
  return pool.filter((tool) => matchesAnyGlob(tool.name, patterns));
};

export const allowList = (names: string[] | undefined): AgentSessionHooks => ({
  prepareRequest: ({ tools }) => ({ tools: filterTools(tools, names) }),
});
