import type { Tool } from 'mu-core';
import type { Agent, AgentRegistry } from '../agents';
import { runSubAgent, type RunSubAgentDeps } from '../subAgents';
import type { SkillRegistry } from './registry';

export interface RunSkillDeps extends RunSubAgentDeps {
  skills: SkillRegistry;
  agents?: AgentRegistry;
}

export const runSkill = async (
  deps: RunSkillDeps,
  args: { skill: string; task: string; agent: string },
): Promise<string> => {
  const skill = deps.skills.get(args.skill);
  if (!skill) throw new Error(`unknown skill "${args.skill}"`);
  const base = deps.agents?.get(args.agent);
  if (!base) throw new Error(`unknown agent "${args.agent}"`);

  const agent: Agent = {
    name: base.name,
    description: skill.description,
    prompt: [base.prompt, skill.prompt].filter(Boolean).join('\n\n'),
    tools: base.tools,
    model: base.model,
  };
  const result = await runSubAgent(agent, args.task, deps);
  return result.text;
};

export const createRunSkillTool = (deps: RunSkillDeps): Tool => ({
  name: 'run_skill',
  description: 'Invoke a sub-agent equipped with a named skill to carry out a specific task. Returns its final answer.',
  prompt:
    'To carry out a self-contained task under a skill, call `run_skill` with the skill name, the task, and the agent persona to run it as.',
  parameters: {
    type: 'object',
    properties: {
      skill: { type: 'string', description: 'Skill name to equip the agent with.' },
      task: { type: 'string', description: 'The precise task to carry out.' },
      agent: { type: 'string', description: 'Agent persona to run the skill as (defines its tools).' },
    },
    required: ['skill', 'task', 'agent'],
    additionalProperties: false,
  },
  run: async (input) => {
    const { skill, task, agent } = (input ?? {}) as { skill?: string; task?: string; agent?: string };
    if (!skill || !task || !agent) {
      return [{ type: 'text', text: 'Error: run_skill requires `skill`, `task`, and `agent`.' }];
    }
    try {
      return [{ type: 'text', text: await runSkill(deps, { skill, task, agent }) }];
    } catch (error) {
      return [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }];
    }
  },
});
