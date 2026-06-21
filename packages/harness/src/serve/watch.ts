import { existsSync, type FSWatcher, watch } from 'node:fs';

export interface WatchOptions {
  dirs: string[];
  onChange: () => void;
  debounceMs?: number;
}

export interface Watcher {
  stop(): void;
}

/**
 * Watch directories for changes and fire a single debounced `onChange`.
 * Product-agnostic: it knows nothing about what's being watched — the caller
 * wires `onChange` to whatever reload it needs.
 */
export function watchDefinitions(opts: WatchOptions): Watcher {
  const { onChange, debounceMs = 200 } = opts;
  // Only watch dirs that exist — a missing dir is not an error here, it just
  // can't be watched. (Caller owns dir creation if it wants new-dir pickup.)
  const dirs = [...new Set(opts.dirs)].filter((d) => existsSync(d));

  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  // Coalesce bursts (editors emit many events per save) into one onChange.
  const fire = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      onChange();
    }, debounceMs);
  };

  // One recursive fs.watch per dir (Node supports recursive on Linux since v20).
  // Wrap per dir so one unwatchable dir doesn't sink the rest.
  const watchers: FSWatcher[] = [];
  for (const dir of dirs) {
    try {
      const w = watch(dir, { recursive: true }, () => {
        if (!stopped) fire();
      });
      w.on('error', () => {});
      watchers.push(w);
    } catch {
      // Unwatchable dir (perms, platform limits) — skip it.
    }
  }

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
