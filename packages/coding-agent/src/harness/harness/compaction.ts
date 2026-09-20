import type { AgentSessionHooks } from '../hooks';

export interface CompactionOptions {
  /** Compact once estimated usage exceeds this fraction of the context window. Default 0.8. */
  thresholdPct?: number;
  /** Number of most-recent messages kept verbatim through a compaction. Default 6. */
  keepLastTurns?: number;
}

/**
 * An `afterTurn` hook that auto-compacts the conversation as it approaches the context
 * window: when the estimated token usage crosses `thresholdPct`, older messages are
 * summarized (keeping the system message + the last `keepLastTurns`). The gap between the
 * threshold and the window is the reserved compaction buffer.
 */
export function createCompactionHook(opts: CompactionOptions = {}): AgentSessionHooks {
  const thresholdPct = opts.thresholdPct ?? 0.8;
  const keepLastTurns = opts.keepLastTurns ?? 6;
  return {
    afterTurn: async ({ messages, contextWindow, compact }) => {
      const window = await contextWindow();
      if (!window) return;
      // Cheap chars/4 estimate — avoids a tokenizer round-trip on every turn.
      const estimate = messages.reduce((n, m) => n + JSON.stringify(m.content).length, 0) / 4;
      if (estimate > window * thresholdPct) await compact({ keepLastTurns });
    },
  };
}
