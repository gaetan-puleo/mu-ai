import { Cron } from 'croner';
import type { Task, TaskRunner, TaskStore } from './types';

export interface Scheduler {
  start(): Promise<void>;
  stop(): void;
  reload(): Promise<void>;
  runNow(id: string): Promise<void>;
}

export const createScheduler = (deps: {
  store: TaskStore;
  run: TaskRunner;
  onError?: (error: unknown, task: Task) => void;
}): Scheduler => {
  const { store, run } = deps;
  const crons = new Map<string, Cron>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let started = false;

  const fire = async (id: string): Promise<void> => {
    const task = await store.get(id);
    if (!task || !task.enabled) return;
    try {
      const result = await run(task);
      await store.update(id, { lastRun: Date.now(), lastResult: result });
    } catch (error) {
      deps.onError?.(error, task);
      const message = error instanceof Error ? error.message : String(error);
      await store.update(id, { lastRun: Date.now(), lastResult: { ok: false, error: message } });
    }
    if (task.schedule.kind === 'once') await store.update(id, { enabled: false });
  };

  const clear = (): void => {
    for (const cron of crons.values()) cron.stop();
    for (const timer of timers.values()) clearTimeout(timer);
    crons.clear();
    timers.clear();
  };

  const schedule = (task: Task): void => {
    if (!task.enabled) return;
    const s = task.schedule;
    if (s.kind === 'cron') {
      crons.set(task.id, new Cron(s.expr, () => void fire(task.id)));
    } else if (s.kind === 'interval') {
      timers.set(task.id, setInterval(() => void fire(task.id), s.ms));
    } else {
      const delay = s.at ? Math.max(0, s.at - Date.now()) : 0;
      timers.set(task.id, setTimeout(() => void fire(task.id), delay));
    }
  };

  const reload = async (): Promise<void> => {
    clear();
    if (!started) return;
    for (const task of await store.list()) schedule(task);
  };

  return {
    start: async () => {
      started = true;
      await reload();
    },
    stop: () => {
      started = false;
      clear();
    },
    reload,
    runNow: (id) => fire(id),
  };
};
