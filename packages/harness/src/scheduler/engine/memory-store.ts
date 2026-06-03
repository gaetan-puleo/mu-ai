import type { Task, TaskStore } from './types';

export const createMemoryTaskStore = (initial: Task[] = []): TaskStore => {
  const tasks = new Map<string, Task>(initial.map((task) => [task.id, task]));
  return {
    list: async () => [...tasks.values()],
    get: async (id) => tasks.get(id),
    create: async (input) => {
      const task: Task = { ...input, id: crypto.randomUUID(), enabled: input.enabled ?? true, createdAt: Date.now() };
      tasks.set(task.id, task);
      return task;
    },
    update: async (id, patch) => {
      const task = tasks.get(id);
      if (!task) return undefined;
      const next: Task = { ...task, ...patch, id: task.id };
      tasks.set(id, next);
      return next;
    },
    remove: async (id) => {
      tasks.delete(id);
    },
  };
};
