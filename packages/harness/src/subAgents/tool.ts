import type { ContentPart, Tool } from 'mu-core';
import type { AgentRegistry } from '../agents';
import { runSubAgent, type RunSubAgentDeps } from './runner';

const BASE_PROMPT =
  'Delegate isolated, fully-specifiable tasks to named sub-agents instead of doing them inline; each returns only its final answer. List several tasks in one call to run them concurrently — put all independent work in a single call rather than one at a time. Brief each sub-agent from scratch, then verify its answer before relying on it.';

interface TaskInput {
  agent?: string;
  task?: string;
}

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
        tasks: {
          type: 'array',
          description: 'One or more tasks to delegate; multiple entries run in parallel.',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              agent: { type: 'string', description: 'Sub-agent name.' },
              task: { type: 'string', description: 'The task to delegate.' },
            },
            required: ['agent', 'task'],
            additionalProperties: false,
          },
        },
      },
      required: ['tasks'],
      additionalProperties: false,
    },
    run: async (input, ctx) => {
      const { tasks } = (input ?? {}) as { tasks?: TaskInput[] };
      if (!Array.isArray(tasks) || tasks.length === 0) {
        return [{ type: 'text', text: 'Error: subagent requires a non-empty `tasks` array.' }];
      }
      const results = await Promise.all(tasks.map(({ agent, task }) => runOne(agent, task, deps, ctx.signal)));
      const labeled = results.length > 1;
      return results.map(({ agent, text }): ContentPart => ({
        type: 'text',
        text: labeled ? `[${agent ?? 'unknown'}]\n${text}` : text,
      }));
    },
  };
};

const runOne = async (
  agent: string | undefined,
  task: string | undefined,
  deps: { registry: AgentRegistry } & RunSubAgentDeps,
  signal?: AbortSignal,
): Promise<{ agent?: string; text: string }> => {
  if (!agent || !task) return { agent, text: 'Error: each task requires `agent` and `task`.' };
  const def = deps.registry.get(agent);
  if (!def) return { agent, text: `Error: unknown sub-agent "${agent}".` };
  try {
    const result = await runSubAgent(def, task, {
      spawn: deps.spawn,
      runs: deps.runs,
      parentId: deps.parentId,
      signal,
    });
    return { agent, text: result.text };
  } catch (err) {
    return { agent, text: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
};
