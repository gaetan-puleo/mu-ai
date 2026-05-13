/**
 * mu-scheduler — Plugin wrapper around `createScheduler`.
 *
 * Each cron tick resolves the target session via `api.getSession`
 * (falling back to a fresh `api.createSession()`) and drives one turn
 * through `session.run({ userMessage })`. Lifecycle events are
 * forwarded to the host-provided `onTaskEvent` so the host decides
 * where to route them (typically a WS push).
 */

import { newMessage, type Plugin, type Session } from 'mu-core';
import { createScheduler } from './scheduler';
import type { ScheduledTask, SchedulerTaskEvent } from './types';

export interface SchedulerPluginOptions {
  /** YAML task files directory. Optional. */
  tasksDir?: string;
  /** Inline tasks (merged with whatever `tasksDir` resolves). */
  tasks?: ScheduledTask[];
  /** Sink for lifecycle events. Defaults to no-op. */
  onTaskEvent?: (event: SchedulerTaskEvent) => void;
}

export function createSchedulerPlugin(opts: SchedulerPluginOptions = {}): Plugin {
  let stop: (() => void) | null = null;
  return {
    name: 'mu-scheduler',
    register(api) {
      const handle = createScheduler({
        tasksDir: opts.tasksDir,
        tasks: opts.tasks,
        onTaskEvent: opts.onTaskEvent,
        submitText: async ({ sessionId, text }) => {
          const session: Session = api.getSession(sessionId) ?? api.createSession();
          const userMessage = newMessage({ role: 'user', content: text });
          for await (const ev of session.run({ userMessage })) {
            if (ev.type === 'turn_end' && ev.error) throw ev.error;
          }
        },
      });
      stop = handle.stop;
    },
    async deactivate() {
      stop?.();
      stop = null;
    },
  };
}
