import type { Tool } from 'mu-core';
import type { AgentRegistry } from '../agents';
import { runSubAgent, type RunSubAgentDeps } from './runner';

const BASE_PROMPT =
  'Delegate an isolated, fully-specifiable task to a named sub-agent instead of doing it inline; it returns only its final answer. Pick the matching sub-agent, brief it from scratch, then verify its answer before relying on it.';

export const createSubAgentTool = (deps: { registry: AgentRegistry } & RunSubAgentDeps): Tool => {
  const roster = deps.registry.list()
    .filter((agent) => agent.name !== 'title')
    .map((agent) => `- ${agent.name}: ${agent.description}`)
    .join('\n');
  return {
    name: 'subagent',
    description: roster ? `${BASE_PROMPT}\n\nAvailable sub-agents:\n${roster}` : BASE_PROMPT,
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Sub-agent name.' },
        task: { type: 'string', description: 'The task to delegate.' },
      },
      required: ['agent', 'task'],
      additionalProperties: false,
    },
    run: async (input, ctx) => {
      const { agent, task } = (input ?? {}) as { agent?: string; task?: string };
      if (!agent || !task) return [{ type: 'text', text: 'Error: subagent requires `agent` and `task`.' }];
      const def = deps.registry.get(agent);
      if (!def) return [{ type: 'text', text: `Error: unknown sub-agent "${agent}".` }];
      const result = await runSubAgent(def, task, {
        spawn: deps.spawn,
        runs: deps.runs,
        parentId: deps.parentId,
        signal: ctx.signal,
      });
      return [{ type: 'text', text: result.text }];
    },
  };
};
