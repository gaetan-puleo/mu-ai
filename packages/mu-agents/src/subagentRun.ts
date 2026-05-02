/**
 * SubagentRun + SubagentRunRegistry — runtime model of a single subagent
 * dispatch.
 *
 * A run captures everything a UI needs to display a live or historical
 * subagent invocation: its identifier, the live transcript, and a status
 * field that flips through `running → done | error | aborted`.
 *
 * The registry is the single source of truth for both:
 *  - the live header renderer in the parent transcript (subscribed via
 *    `meta.subagentRunId`)
 *  - the subagent browser panel that cycles through every run.
 *
 * Persistence is opt-in via a host-supplied `SessionWriter`. When the host
 * provides one, every notification triggers a throttled write; when it's
 * undefined, runs live in memory only.
 */

import type { ChatMessage } from 'mu-core';
import type { AgentDefinition } from './types';

export type SubagentStatus = 'running' | 'done' | 'error' | 'aborted';

export interface SubagentRun {
  id: string;
  agentName: string;
  agentColor?: string;
  task: string;
  /**
   * Live transcript: starts as `[system, user]` and grows as the nested
   * loop emits `messages` events.
   */
  messages: ChatMessage[];
  status: SubagentStatus;
  startedAt: number;
  finishedAt?: number;
  finalContent?: string;
  error?: string;
  /** Persistence target on disk; absent when no writer is configured. */
  sessionPath?: string;
  /** Aborts the underlying `runAgent` loop. */
  abort: () => void;
}

export type SubagentRunListener = (run: SubagentRun) => void;
export type SubagentRegistryListener = (runs: SubagentRun[]) => void;

export type SessionWriter = (path: string, messages: ChatMessage[]) => Promise<void>;

export interface SubagentRunRegistry {
  /** Snapshot of every run, ordered oldest → newest by `startedAt`. */
  list: () => SubagentRun[];
  get: (id: string) => SubagentRun | undefined;
  /** Emits whenever a run is added, mutated, or removed. */
  subscribe: (listener: SubagentRegistryListener) => () => void;
  /** Per-run subscription used by the live message renderer. */
  subscribeRun: (id: string, listener: SubagentRunListener) => () => void;
  /**
   * Create a run, append it to the registry, and return both the run and
   * an `update` mutator. `update` accepts a partial patch, merges it into
   * the run, broadcasts to subscribers, and (if a writer is set) schedules
   * a throttled persist of the run's transcript.
   */
  start: (input: {
    id: string;
    agent: AgentDefinition;
    task: string;
    initialMessages: ChatMessage[];
    sessionPath?: string;
    abort: () => void;
  }) => {
    run: SubagentRun;
    update: (patch: Partial<SubagentRun>) => void;
    finish: (patch: Partial<SubagentRun>) => Promise<void>;
  };
  /** Adopt a previously-completed run loaded from disk. */
  hydrate: (run: SubagentRun) => void;
  /** Drop every run (used when the parent session resets). */
  clear: () => void;
  /** Configure the persistence writer; pass `undefined` to disable. */
  setSessionWriter: (writer: SessionWriter | undefined) => void;
}

const PERSIST_DEBOUNCE_MS = 250;

interface RegistryState {
  runs: Map<string, SubagentRun>;
  order: string[];
  registryListeners: Set<SubagentRegistryListener>;
  runListeners: Map<string, Set<SubagentRunListener>>;
  persistTimers: Map<string, ReturnType<typeof setTimeout>>;
  writer: SessionWriter | undefined;
}

function makeState(): RegistryState {
  return {
    runs: new Map(),
    order: [],
    registryListeners: new Set(),
    runListeners: new Map(),
    persistTimers: new Map(),
    writer: undefined,
  };
}

function snapshot(state: RegistryState): SubagentRun[] {
  return state.order.map((id) => state.runs.get(id)).filter((r): r is SubagentRun => Boolean(r));
}

function emitRegistry(state: RegistryState): void {
  const snap = snapshot(state);
  for (const fn of state.registryListeners) fn(snap);
}

function emitRun(state: RegistryState, id: string): void {
  const run = state.runs.get(id);
  if (!run) return;
  const set = state.runListeners.get(id);
  if (!set) return;
  for (const fn of set) fn(run);
}

function schedulePersist(state: RegistryState, id: string): void {
  const run = state.runs.get(id);
  if (!(state.writer && run?.sessionPath)) return;
  const existing = state.persistTimers.get(id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    state.persistTimers.delete(id);
    const target = state.runs.get(id);
    if (!(state.writer && target?.sessionPath)) return;
    void state.writer(target.sessionPath, target.messages).catch((err) => {
      console.error(`[mu-agents] subagent persist failed (${id}):`, err);
    });
  }, PERSIST_DEBOUNCE_MS);
  state.persistTimers.set(id, timer);
}

async function flushPersist(state: RegistryState, id: string): Promise<void> {
  const timer = state.persistTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    state.persistTimers.delete(id);
  }
  const run = state.runs.get(id);
  if (!(state.writer && run?.sessionPath)) return;
  try {
    await state.writer(run.sessionPath, run.messages);
  } catch (err) {
    console.error(`[mu-agents] subagent flush failed (${id}):`, err);
  }
}

function startRun(
  state: RegistryState,
  input: {
    id: string;
    agent: AgentDefinition;
    task: string;
    initialMessages: ChatMessage[];
    sessionPath?: string;
    abort: () => void;
  },
): {
  run: SubagentRun;
  update: (patch: Partial<SubagentRun>) => void;
  finish: (patch: Partial<SubagentRun>) => Promise<void>;
} {
  const { id, agent, task, initialMessages, sessionPath, abort } = input;
  const run: SubagentRun = {
    id,
    agentName: agent.name,
    agentColor: agent.color,
    task,
    messages: initialMessages,
    status: 'running',
    startedAt: Date.now(),
    sessionPath,
    abort,
  };
  state.runs.set(id, run);
  state.order.push(id);
  emitRegistry(state);
  emitRun(state, id);
  schedulePersist(state, id);

  const update = (patch: Partial<SubagentRun>): void => {
    const current = state.runs.get(id);
    if (!current) return;
    state.runs.set(id, { ...current, ...patch });
    emitRun(state, id);
    emitRegistry(state);
    if (patch.messages) schedulePersist(state, id);
  };

  const finish = async (patch: Partial<SubagentRun>): Promise<void> => {
    update({ ...patch, finishedAt: Date.now() });
    await flushPersist(state, id);
  };

  return { run, update, finish };
}

function subscribeRun(state: RegistryState, id: string, listener: SubagentRunListener): () => void {
  let set = state.runListeners.get(id);
  if (!set) {
    set = new Set();
    state.runListeners.set(id, set);
  }
  set.add(listener);
  const run = state.runs.get(id);
  if (run) listener(run);
  return () => {
    set.delete(listener);
    if (set.size === 0) state.runListeners.delete(id);
  };
}

function hydrateRun(state: RegistryState, run: SubagentRun): void {
  if (state.runs.has(run.id)) return;
  state.runs.set(run.id, run);
  state.order.push(run.id);
  // Keep order sorted by startedAt so freshly-loaded historic runs slot
  // into chronological position rather than always being newest.
  state.order.sort((a, b) => (state.runs.get(a)?.startedAt ?? 0) - (state.runs.get(b)?.startedAt ?? 0));
  emitRegistry(state);
  emitRun(state, run.id);
}

function clearAll(state: RegistryState): void {
  for (const timer of state.persistTimers.values()) clearTimeout(timer);
  state.persistTimers.clear();
  state.runs.clear();
  state.order.length = 0;
  state.runListeners.clear();
  emitRegistry(state);
}

export function createSubagentRunRegistry(): SubagentRunRegistry {
  const state = makeState();
  return {
    list: () => snapshot(state),
    get: (id) => state.runs.get(id),
    subscribe(listener) {
      state.registryListeners.add(listener);
      listener(snapshot(state));
      return () => {
        state.registryListeners.delete(listener);
      };
    },
    subscribeRun: (id, listener) => subscribeRun(state, id, listener),
    start: (input) => startRun(state, input),
    hydrate: (run) => hydrateRun(state, run),
    clear: () => clearAll(state),
    setSessionWriter: (next) => {
      state.writer = next;
    },
  };
}
