import type { Tool } from 'mu-core';
import type { Schedule, TaskStore } from './engine';
import type { SkillRegistry } from '../skills';

const toSchedule = (raw: unknown): Schedule | undefined => {
  const { cron, everyMs, at } = (raw ?? {}) as { cron?: string; everyMs?: number; at?: number };
  if (typeof cron === 'string' && cron.trim()) return { kind: 'cron', expr: cron.trim() };
  if (typeof everyMs === 'number' && everyMs > 0) return { kind: 'interval', ms: everyMs };
  if (typeof at === 'number') return { kind: 'once', at };
  return undefined;
};

export const createScheduleTaskTool = (
  deps: { store: TaskStore; skills: SkillRegistry; onChange?: () => void | Promise<void> },
): Tool => ({
  name: 'schedule_task',
  description:
    'Persist a recurring (cron / heartbeat) or one-shot task that runs a sub-agent under a skill on a given prompt.',
  prompt:
    'Use `schedule_task` to register work that should run later or on a schedule: a `cron` expression, an `everyMs` heartbeat, or a one-shot `at` timestamp. It invokes a skill on a prompt, like `run_skill`.',
  parameters: {
    type: 'object',
    properties: {
      skill: { type: 'string', description: 'Skill name to run.' },
      prompt: { type: 'string', description: 'The task prompt handed to the agent on each run.' },
      agent: { type: 'string', description: 'Agent persona to run the skill as (defines its tools).' },
      schedule: {
        type: 'object',
        description: 'Exactly one of: cron, everyMs, at.',
        properties: {
          cron: { type: 'string', description: 'Cron expression, e.g. "0 9 * * *".' },
          everyMs: { type: 'number', description: 'Heartbeat interval in milliseconds.' },
          at: { type: 'number', description: 'One-shot epoch-ms timestamp (omit to run as soon as scheduled).' },
        },
        additionalProperties: false,
      },
    },
    required: ['skill', 'prompt', 'agent', 'schedule'],
    additionalProperties: false,
  },
  run: async (input) => {
    const { skill, prompt, agent, schedule } = (input ?? {}) as {
      skill?: string;
      prompt?: string;
      agent?: string;
      schedule?: unknown;
    };
    if (!skill || !prompt || !agent) {
      return [{ type: 'text', text: 'Error: schedule_task requires `skill`, `prompt`, and `agent`.' }];
    }
    if (!deps.skills.get(skill)) return [{ type: 'text', text: `Error: unknown skill "${skill}".` }];
    const parsed = toSchedule(schedule);
    if (!parsed) return [{ type: 'text', text: 'Error: schedule needs one of `cron`, `everyMs`, or `at`.' }];

    const task = await deps.store.create({ skill, prompt, agent, schedule: parsed });
    await deps.onChange?.();
    return [{ type: 'text', text: `Scheduled task ${task.id} (${parsed.kind}) running skill "${skill}".` }];
  },
});
