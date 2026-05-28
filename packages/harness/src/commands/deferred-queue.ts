/**
 * Queue for commands that should defer until the runtime is idle.
 *
 * Slash commands like `/thinking` toggle host state — running them mid-turn
 * would race with the assistant stream. Hosts mark such commands
 * `deferWhenBusy: true`; this queue holds them and drains on the next idle.
 *
 * Generic over the queued payload so a host can store labels, callbacks,
 * or anything else useful to its waiting-list UI.
 */
export interface DeferredCommandQueue<Entry> {
  /** Add an entry to the tail. */
  push(entry: Entry): void;
  /** Snapshot — for rendering a waiting list, etc. The queue itself is unchanged. */
  snapshot(): readonly Entry[];
  /** Schedule a drain in the next macro-task if there's anything queued. No-op when a drain is already scheduled. */
  scheduleDrain(): void;
  /** Number of pending entries. */
  size(): number;
  /** Drop everything without running. */
  clear(): void;
}

export interface CreateDeferredCommandQueueOptions<Entry> {
  /**
   * True iff a drain is allowed right now (typically `runtime.state() === 'idle'`).
   * Re-checked at scheduleDrain time AND inside the drain tick so a quick
   * state flip doesn't run side effects against a busy runtime.
   */
  canDrain(): boolean;
  /** Invoked once per queued entry during a drain. Exceptions are swallowed per entry. */
  runEntry(entry: Entry): void;
  /** Called after every push and after a drain so the host can refresh its waiting list. */
  onChange?: () => void;
}

export function createDeferredCommandQueue<Entry>(
  opts: CreateDeferredCommandQueueOptions<Entry>,
): DeferredCommandQueue<Entry> {
  const queue: Entry[] = [];
  let drainTimer: ReturnType<typeof setTimeout> | undefined;

  const drain = (): void => {
    drainTimer = undefined;
    if (!opts.canDrain()) return;
    if (queue.length === 0) return;
    const taken = queue.splice(0);
    opts.onChange?.();
    for (const entry of taken) {
      try {
        opts.runEntry(entry);
      } catch { /* swallow: one bad entry must not poison the drain */ }
    }
  };

  return {
    push(entry) {
      queue.push(entry);
      opts.onChange?.();
    },
    snapshot() {
      return queue;
    },
    scheduleDrain() {
      if (drainTimer) return;
      if (queue.length === 0) return;
      drainTimer = setTimeout(drain, 0);
    },
    size() {
      return queue.length;
    },
    clear() {
      if (queue.length === 0) return;
      queue.length = 0;
      opts.onChange?.();
    },
  };
}
