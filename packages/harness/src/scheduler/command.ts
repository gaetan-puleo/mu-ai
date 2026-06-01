import type { TaskStore } from './engine';
import type { Command } from '../commands';

export const createTasksCommand = (tasks: TaskStore): Command => ({
  name: 'tasks',
  description: 'List scheduled tasks',
  run: async () => {
    const list = await tasks.list();
    if (list.length === 0) return { ok: true, output: 'No tasks scheduled.' };
    const describe = (t: (typeof list)[number]): string => {
      const when = t.schedule.kind === 'cron'
        ? t.schedule.expr
        : t.schedule.kind === 'interval'
        ? `every ${t.schedule.ms}ms`
        : 'once';
      const state = t.enabled ? when : `${when} (disabled)`;
      return `- ${t.id} — ${t.skill} [${state}]`;
    };
    return { ok: true, output: list.map(describe).join('\n') };
  },
});
