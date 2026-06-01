import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Task, TaskStore } from './types';

export const createTaskStore = (options: { dir: string }): TaskStore => {
  const { dir } = options;
  const file = (id: string): string => join(dir, `${id}.json`);

  const read = async (id: string): Promise<Task | undefined> => {
    try {
      return JSON.parse(await readFile(file(id), 'utf-8')) as Task;
    } catch {
      return undefined;
    }
  };

  const write = async (task: Task): Promise<void> => {
    await mkdir(dir, { recursive: true });
    await writeFile(file(task.id), JSON.stringify(task, null, 2), 'utf-8');
  };

  return {
    list: async () => {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        return [];
      }
      const tasks: Task[] = [];
      for (const name of entries.sort()) {
        if (!name.endsWith('.json')) continue;
        const task = await read(name.slice(0, -'.json'.length));
        if (task) tasks.push(task);
      }
      return tasks;
    },
    get: read,
    create: async (input) => {
      const task: Task = { ...input, id: crypto.randomUUID(), enabled: input.enabled ?? true, createdAt: Date.now() };
      await write(task);
      return task;
    },
    update: async (id, patch) => {
      const task = await read(id);
      if (!task) return undefined;
      const next: Task = { ...task, ...patch, id: task.id };
      await write(next);
      return next;
    },
    remove: async (id) => {
      await rm(file(id), { force: true });
    },
  };
};
