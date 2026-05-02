/**
 * Subagent browser state machine.
 *
 * Exposes:
 *  - the live list of `SubagentRun`s (subscribed to the registry)
 *  - the current `viewMode` (chat vs browsing a specific run)
 *  - keyboard handlers wired through `useChordKeyboard`:
 *      Ctrl+X ↓        — enter browser at the most recent run
 *      Ctrl+X →        — next run (loops)
 *      Ctrl+X ←        — previous run (loops)
 *      Ctrl+X ↑ or Esc — back to chat
 *
 * Returning to chat happens via the `Esc` handler the panel registers
 * directly (kept outside the chord so it's reachable without the prefix).
 */

import { useInput } from 'ink';
import type { SubagentRun, SubagentRunRegistry } from 'mu-agents';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useChordKeyboard } from '../hooks/useChordKeyboard';

export type SubagentViewMode = { kind: 'chat' } | { kind: 'subagent'; runId: string };

export interface SubagentBrowserState {
  mode: SubagentViewMode;
  runs: SubagentRun[];
  currentRun: SubagentRun | undefined;
  /** 1-based position of the current run (for UI labels like "i / N"). */
  position: { index: number; total: number } | null;
  enterLatest: () => void;
  next: () => void;
  prev: () => void;
  exit: () => void;
}

const NOOP = (): void => {
  // Intentional: returned by the empty-registry shape so call sites can
  // wire handlers up without null-checking each invocation.
};

const EMPTY_BROWSER: SubagentBrowserState = {
  mode: { kind: 'chat' },
  runs: [],
  currentRun: undefined,
  position: null,
  enterLatest: NOOP,
  next: NOOP,
  prev: NOOP,
  exit: NOOP,
};

export function useSubagentBrowser(registry: SubagentRunRegistry | undefined): SubagentBrowserState {
  const [runs, setRuns] = useState<SubagentRun[]>(() => registry?.list() ?? []);
  const [mode, setMode] = useState<SubagentViewMode>({ kind: 'chat' });

  // Subscribe to registry events; the listener fires immediately on
  // subscribe with the current snapshot, so the initial state is correct
  // even when the registry already has runs from a resumed session.
  useEffect(() => {
    if (!registry) return;
    return registry.subscribe((next) => setRuns(next));
  }, [registry]);

  // If the run we're showing disappears (registry cleared on /new), bounce
  // back to chat so the user isn't stuck on a phantom run.
  useEffect(() => {
    if (mode.kind !== 'subagent') return;
    if (!runs.some((r) => r.id === mode.runId)) setMode({ kind: 'chat' });
  }, [runs, mode]);

  const exit = useCallback(() => setMode({ kind: 'chat' }), []);

  const enterLatest = useCallback(() => {
    if (runs.length === 0) return;
    const last = runs[runs.length - 1];
    setMode({ kind: 'subagent', runId: last.id });
  }, [runs]);

  const cycle = useCallback(
    (direction: 1 | -1) => {
      if (runs.length === 0) return;
      const currentId = mode.kind === 'subagent' ? mode.runId : runs[runs.length - 1].id;
      const idx = runs.findIndex((r) => r.id === currentId);
      const start = idx === -1 ? runs.length - 1 : idx;
      const len = runs.length;
      // Wrap-around — `(start + direction + len) % len` is the canonical
      // modulo trick that handles negative results in JS (`%` keeps sign).
      const nextIdx = (start + direction + len) % len;
      setMode({ kind: 'subagent', runId: runs[nextIdx].id });
    },
    [mode, runs],
  );

  const next = useCallback(() => cycle(1), [cycle]);
  const prev = useCallback(() => cycle(-1), [cycle]);

  // Ctrl+X chord is always armed, but the follow-ups are no-ops while no
  // subagent run exists (so the user gets terminal-bell silence rather
  // than an unexpected mode switch).
  useChordKeyboard({
    prefix: ({ key, input }) => key.ctrl === true && input === 'x',
    followUps: [
      { match: ({ key }) => key.downArrow === true, handler: enterLatest },
      { match: ({ key }) => key.rightArrow === true, handler: next },
      { match: ({ key }) => key.leftArrow === true, handler: prev },
      { match: ({ key }) => key.upArrow === true, handler: exit },
    ],
  });

  // Esc returns to chat from the browser. Active only while we're actually
  // showing a run; otherwise we'd intercept Esc clearing modal/picker UIs.
  useInput(
    (_input, key) => {
      if (key.escape) exit();
    },
    { isActive: mode.kind === 'subagent' },
  );

  const currentRun = useMemo(
    () => (mode.kind === 'subagent' ? runs.find((r) => r.id === mode.runId) : undefined),
    [mode, runs],
  );
  const position = useMemo(() => {
    if (mode.kind !== 'subagent') return null;
    const i = runs.findIndex((r) => r.id === mode.runId);
    if (i === -1) return null;
    return { index: i + 1, total: runs.length };
  }, [mode, runs]);

  if (!registry) return EMPTY_BROWSER;

  return { mode, runs, currentRun, position, enterLatest, next, prev, exit };
}
