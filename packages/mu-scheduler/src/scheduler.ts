/**
 * mu-scheduler — YAML-driven cron task runner for mu hosts.
 *
 * Each task fires `submitText({ sessionId, text: task.prompt })` through
 * the host-provided callback (typically `runtime.submitText`). This is
 * the same canonical turn path every other channel uses.
 *
 * Lifecycle events (`started`/`completed`/`failed`) go through
 * `onTaskEvent` so the host decides where to route them.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cron } from 'croner';
import { newTaskSessionId, nowMs } from 'mu-core';
import { parse } from 'yaml';
import type { ScheduledTask, SchedulerHandle, SchedulerOptions, SchedulerTaskEvent } from './types';

interface SchedulerJob {
  stop: () => void;
}

function loadTasksFromDir(tasksDir: string): ScheduledTask[] {
  if (!existsSync(tasksDir)) return [];
  const files = readdirSync(tasksDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  const out: ScheduledTask[] = [];
  for (const file of files) {
    const filePath = join(tasksDir, file);
    const raw = readFileSync(filePath, 'utf8');
    const parsed = parse(raw);
    if (parsed == null) continue;
    const list = Array.isArray(parsed) ? parsed : [parsed as ScheduledTask];
    for (const task of list) {
      if (!(task?.id && task.cron && task.prompt)) continue;
      out.push(task);
    }
  }
  return out;
}

function scheduleTask(
  task: ScheduledTask,
  opts: SchedulerOptions,
  emit: (event: SchedulerTaskEvent) => void,
): SchedulerJob {
  const job = new Cron(
    task.cron,
    async () => {
      const sessionId = newTaskSessionId(task.id);
      emit({ kind: 'started', taskId: task.id, sessionId, at: nowMs() });
      try {
        await opts.submitText({ sessionId, text: task.prompt });
        emit({ kind: 'completed', taskId: task.id, sessionId, at: nowMs() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emit({ kind: 'failed', taskId: task.id, sessionId, error: msg });
      }
    },
    {
      timezone: 'UTC',
      catch: false,
    },
  );

  return { stop: () => job.stop() };
}

export function createScheduler(opts: SchedulerOptions): SchedulerHandle {
  const onEvent =
    opts.onTaskEvent ??
    ((): void => {
      // default sink: drop events
    });
  const tasks: ScheduledTask[] = [];
  if (opts.tasksDir) tasks.push(...loadTasksFromDir(opts.tasksDir));
  if (opts.tasks) tasks.push(...opts.tasks);

  const jobs: SchedulerJob[] = [];
  for (const task of tasks) {
    jobs.push(scheduleTask(task, opts, onEvent));
  }

  return {
    stop: (): void => {
      for (const job of jobs) job.stop();
    },
  };
}
