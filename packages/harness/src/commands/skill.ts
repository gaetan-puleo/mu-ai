import type { Agent } from '../agents';
import { runSkill, type RunSkillDeps, type Skill } from '../skills';
import type { Command } from './types';

export type SkillCommandDeps = RunSkillDeps & { activeAgent?: () => Agent | undefined };

export const createSkillCommand = (skill: Skill, deps: SkillCommandDeps): Command => ({
  name: skill.command!,
  description: skill.description || `Run the "${skill.name}" skill`,
  run: async (args) => {
    const agent = deps.activeAgent?.()?.name ?? deps.agents?.list()[0]?.name;
    if (!agent) return { ok: false, error: 'no agent available to run the skill' };
    try {
      return { ok: true, output: await runSkill(deps, { skill: skill.name, task: args, agent }) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
