import { existsSync, type FSWatcher, mkdirSync, watch } from 'node:fs';
import { errMsg } from 'mu-core';

export interface WatchOptions {
  dirs: string[];
  onChange: () => void | Promise<void>;
  debounceMs?: number;
  /** Return true for a changed filename that should NOT trigger `onChange`. Lets a
   * caller keep runtime state (e.g. a scheduler state file) in a watched dir
   * without every write bouncing back as a spurious reload. */
  ignore?: (filename: string) => boolean;
  /** Create each dir if missing so a file created there later is picked up
   * (default true). When false, only already-existing dirs are watched. */
  ensureDirs?: boolean;
  log?: (message: string) => void;
}

export interface Watcher {
  stop(): void;
}

/**
 * Watch directories for changes and fire a single debounced `onChange`.
 * Product-agnostic: it knows nothing about what's being watched — the caller
 * wires `onChange` to whatever reload it needs. One recursive `fs.watch` per
 * dir (Node supports recursive on Linux since v20); an unwatchable dir is
 * skipped rather than sinking the rest.
 */
export function watchDefinitions(opts: WatchOptions): Watcher {
  const { onChange, debounceMs = 200, ignore, ensureDirs = true, log } = opts;
  const dirs = [...new Set(opts.dirs)].filter((d) => {
    try {
      if (ensureDirs) mkdirSync(d, { recursive: true });
      return true;
    } catch {
      return existsSync(d);
    }
  });
  if (dirs.length === 0) return { stop: () => {} };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  // Coalesce bursts (editors emit many events per save) into one onChange.
  const fire = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void Promise.resolve(onChange()).catch((err) =>
        log?.(`reload failed: ${errMsg(err)}`),
      );
    }, debounceMs);
  };

  const watchers: FSWatcher[] = [];
  for (const dir of dirs) {
    try {
      const w = watch(dir, { recursive: true }, (_event, filename) => {
        if (stopped) return;
        if (ignore && typeof filename === 'string' && ignore(filename)) return;
        fire();
      });
      w.on('error', (err) => {
        if (!stopped) log?.(`watcher stopped: ${errMsg(err)}`);
      });
      watchers.push(w);
    } catch {
      // Unwatchable dir (perms, platform limits) — skip it.
    }
  }

  log?.(`watching ${dirs.length} dir(s) for changes`);
  return {
    stop: () => {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // already closed
        }
      }
    },
  };
}
