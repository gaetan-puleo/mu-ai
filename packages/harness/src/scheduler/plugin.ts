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
  | { type: 'task_completed'; task: SchedulerTask; at: number; durationMs: number }
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

    // Subscribe to the runtime state machine so we can emit `task_completed`
    // after the launched turn drains. `seenRunning` filters out the publish
    // race: state may still be `idle` immediately after publish, only flipping
    // to `running` once the runtime picks the message off the queue.
    //
    // Caveat: if the runtime is already serving a chat turn when the task
    // fires, our `user_message` is queued; the `task_completed` emission
    // will correlate with whatever turn ends NEXT, which may be the chat
    // (not our cron task). Tracking which message produced which idle would
    // need a message-id correlator on the bus; for now this is a best-effort
    // signal, sufficient for the "task finished" UI on the companion.
    let seenRunning = false;
    let unsubscribe: (() => void) | undefined;
    unsubscribe = bus.subscribe((event: CoreEvent) => {
      if (event.type !== 'state_change') return;
      if (event.state === 'running') {
        seenRunning = true;
        return;
      }
      if (!seenRunning) return;
      if (event.state === 'idle' || event.state === 'stopped') {
        const completed = Date.now();
        unsubscribe?.();
        unsubscribe = undefined;
        onEvent?.({ type: 'task_completed', task, at: completed, durationMs: completed - at });
      }
    });

    try {
      // Tag scheduled prompts with `source: 'cron'` so the permission hook
      // (or anything subscribed to the bus) can refuse risky auto-actions
      // it would normally let a real user perform.
      bus.publish({
        type: 'user_message',
        message: { role: 'user', content: task.prompt },
        source: 'cron',
      });
    } catch (err) {
      unsubscribe?.();
      unsubscribe = undefined;
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
