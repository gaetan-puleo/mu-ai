import type { Tool } from 'mu-core';
import type { AgentRegistry } from '../agents';
import { runSubAgent, type RunSubAgentDeps } from './runner';

export const createSubAgentTool = (deps: { registry: AgentRegistry } & RunSubAgentDeps): Tool => ({
  name: 'subagent',
  description: 'Delegate an isolated task to a named sub-agent. Returns its final answer.',
  prompt:
    'Delegate self-contained research or sub-tasks to a named sub-agent with `subagent`; treat its answer as research input.',
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
});
