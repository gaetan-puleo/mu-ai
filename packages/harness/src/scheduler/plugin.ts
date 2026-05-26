/**
 * Cron-based scheduler plugin.
 *
 * Loads YAML task files from `tasksDir`, schedules each task with `croner`,
 * and on each tick publishes a `user_message` to the bus so the agent
 * runtime picks it up like any chat input. Lifecycle hooks (onStart/onStop)
 * tie scheduling to the host runtime.
 *
 * Task file shape (one yaml file may declare an array):
 *
 *   - id: daily-summary
 *     cron: "0 20 * * *"
 *     prompt: Summarize the day.
 *     timezone: Europe/Paris      # optional
 *     channel: companion          # optional, surfaced in events
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cron } from 'croner';
import { parse as parseYaml } from '@std/yaml';
import type { CoreEvent, EventBus, Plugin } from 'mu-core';

export interface SchedulerTask {
  id: string;
  cron: string;
  prompt: string;
  timezone?: string;
  channel?: string;
}

export type SchedulerEvent =
  | { type: 'task_started'; task: SchedulerTask; at: number }
  | { type: 'task_failed'; task: SchedulerTask; at: number; error: string };

export interface SchedulerOptions {
  tasksDir?: string;
  bus: EventBus<CoreEvent>;
  onEvent?: (event: SchedulerEvent) => void;
}

export function createSchedulerPlugin(opts: SchedulerOptions): Plugin {
  const jobs: Cron[] = [];

  return {
    name: 'mu-scheduler',
    hooks: {
      onStart: () => {
        const tasks = opts.tasksDir ? loadTasks(opts.tasksDir) : [];
        for (const task of tasks) {
          try {
            jobs.push(scheduleTask(task, opts.bus, opts.onEvent));
          } catch (err) {
            opts.onEvent?.({
              type: 'task_failed',
              task,
              at: Date.now(),
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      },
      onStop: () => {
        for (const job of jobs) job.stop();
        jobs.length = 0;
      },
    },
  };
}

function scheduleTask(
  task: SchedulerTask,
  bus: EventBus<CoreEvent>,
  onEvent?: (event: SchedulerEvent) => void,
): Cron {
  return new Cron(task.cron, { timezone: task.timezone, name: task.id }, () => {
    const at = Date.now();
    onEvent?.({ type: 'task_started', task, at });
    try {
      bus.publish({ type: 'user_message', message: { role: 'user', content: task.prompt } });
    } catch (err) {
      onEvent?.({
        type: 'task_failed',
        task,
        at,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

function loadTasks(dir: string): SchedulerTask[] {
  if (!existsSync(dir)) return [];
  const out: SchedulerTask[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    const raw = readFileSync(join(dir, file), 'utf-8');
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch {
      continue;
    }
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of entries) {
      const task = normalize(entry);
      if (task) out.push(task);
    }
  }
  return out;
}

function normalize(value: unknown): SchedulerTask | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.cron !== 'string' || typeof r.prompt !== 'string') {
    return undefined;
  }
  return {
    id: r.id,
    cron: r.cron,
    prompt: r.prompt,
    timezone: typeof r.timezone === 'string' ? r.timezone : undefined,
    channel: typeof r.channel === 'string' ? r.channel : undefined,
  };
}
