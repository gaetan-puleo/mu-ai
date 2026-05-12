export interface ScheduledTask {
  id: string;
  agent?: string;
  cron: string;
  prompt: string;
  /** Free-form label, no transport coupling. Defaults to 'scheduler'. */
  channel?: string;
}

export type SchedulerTaskEvent =
  | { kind: 'started'; taskId: string; sessionId: string; at: number }
  | { kind: 'output'; taskId: string; sessionId: string; text: string }
  | { kind: 'completed'; taskId: string; sessionId: string; at: number }
  | { kind: 'failed'; taskId: string; sessionId: string; error: string };

export interface SchedulerOptions {
  /** Canonical turn entry point — typically `runtime.submitText`. */
  submitText: (input: { sessionId: string; text: string }) => Promise<unknown>;
  /** Directory to scan for YAML task files. Optional. */
  tasksDir?: string;
  /** Inline task list. Merged with whatever `tasksDir` resolves. */
  tasks?: ScheduledTask[];
  /** Sink for lifecycle events. Defaults to no-op. */
  onTaskEvent?: (event: SchedulerTaskEvent) => void;
}

export interface SchedulerHandle {
  stop: () => void;
}
