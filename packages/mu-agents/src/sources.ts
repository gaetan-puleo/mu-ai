/**
 * AgentSourceManager — watches one or more directories of agent `.md` files
 * and emits a flat list of agent definitions (ordered by registration).
 *
 * Used by the mu-agents plugin to wire up file-based agent definitions; hosts
 * register additional sources via `ctx.agents?.registerSource(absolutePath)`.
 *
 * Hot-reload: changes are debounced (100ms) so a flurry of editor saves
 * results in a single re-emit. The change takes effect on the next agent
 * turn — runs in flight are not interrupted.
 */

import { existsSync } from 'node:fs';
import chokidar, { type FSWatcher } from 'chokidar';
import type { AgentSourceRegistry } from 'mu-core';
import { loadAgentsFromDir } from './markdown';
import type { AgentDefinition } from './types';

// Re-export so callers who import from mu-agents get the canonical type.
export type { AgentSourceRegistry } from 'mu-core';

export interface AgentSourceManager extends AgentSourceRegistry {
  list: () => AgentDefinition[];
  onChange: (listener: (agents: AgentDefinition[]) => void) => () => void;
  dispose: () => Promise<void>;
}

interface SourceEntry {
  dir: string;
  watcher: FSWatcher;
}

export function createAgentSourceManager(): AgentSourceManager {
  const sources: SourceEntry[] = [];
  const listeners = new Set<(agents: AgentDefinition[]) => void>();
  let debounce: ReturnType<typeof setTimeout> | null = null;

  function recompute(): AgentDefinition[] {
    const out: AgentDefinition[] = [];
    for (const s of sources) {
      try {
        out.push(...loadAgentsFromDir(s.dir));
      } catch {
        // ignore; loaders should be tolerant
      }
    }
    return out;
  }

  function emit(): void {
    const agents = recompute();
    for (const fn of listeners) {
      try {
        fn(agents);
      } catch {
        // listeners must not break the manager
      }
    }
  }

  function scheduleEmit(): void {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      emit();
    }, 100);
  }

  return {
    registerSource(absoluteDirPath) {
      // chokidar follows symlinks / falls back to parent on missing paths,
      // which can trigger EACCES on protected directories. Skip non-existent
      // sources and re-emit so the host's listener still sees the (empty) state.
      if (!existsSync(absoluteDirPath)) {
        scheduleEmit();
        const noopWatcher = chokidar.watch([], { persistent: false });
        const entry: SourceEntry = { dir: absoluteDirPath, watcher: noopWatcher };
        sources.push(entry);
        return () => {
          const idx = sources.indexOf(entry);
          if (idx !== -1) sources.splice(idx, 1);
          void noopWatcher.close();
          scheduleEmit();
        };
      }
      const watcher = chokidar.watch(absoluteDirPath, {
        ignoreInitial: true,
        persistent: true,
        depth: 0,
      });
      const entry: SourceEntry = { dir: absoluteDirPath, watcher };
      watcher.on('add', scheduleEmit);
      watcher.on('change', scheduleEmit);
      watcher.on('unlink', scheduleEmit);
      // Surface watcher errors to stderr but don't crash the host.
      watcher.on('error', (err) => {
        console.warn(`[mu-agents] watcher error in ${absoluteDirPath}:`, err);
      });
      sources.push(entry);
      return () => {
        const idx = sources.indexOf(entry);
        if (idx !== -1) sources.splice(idx, 1);
        void watcher.close();
        scheduleEmit();
      };
    },
    list() {
      return recompute();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async dispose() {
      if (debounce) clearTimeout(debounce);
      for (const s of sources) await s.watcher.close();
      sources.length = 0;
      listeners.clear();
    },
  };
}
