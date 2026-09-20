import type { Tool } from 'mu-core';
import { type AgentSessionHooks, mergeHooks } from '../hooks';
import type { Plugin } from './types';

export interface Resolved {
  tools: Tool[];
  hooks: AgentSessionHooks;
}

export interface ResolveInput {
  tools?: Tool[];
  hooks?: AgentSessionHooks;
  plugins?: Plugin[];
}

export const resolve = (config: ResolveInput): Resolved => {
  const plugins = config.plugins ?? [];
  return {
    tools: dedupeTools([...plugins.flatMap((p) => p.tools ?? []), ...(config.tools ?? [])]),
    hooks: mergeHooks([...plugins.map((p) => p.hooks), config.hooks]),
  };
};

const dedupeTools = (tools: Tool[]): Tool[] => {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) throw new Error(`AgentSession: duplicate tool name "${tool.name}"`);
    seen.add(tool.name);
  }
  return tools;
};
