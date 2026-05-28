/**
 * Bounded, deduped input-history buffer backed by a JSON array on disk.
 *
 * - `load()` returns the most recent `max` entries (default 500).
 * - `append()` drops a duplicate of the last entry and trims to `max`.
 * - Parse errors and write errors are swallowed (`history.json` is best-effort —
 *   losing it should never crash a host on startup or input).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface HistoryStore {
  readonly path: string;
  load(): string[];
  append(entry: string): void;
}

export interface CreateHistoryStoreOptions {
  path: string;
  /** Soft cap on retained entries. Defaults to 500. */
  max?: number;
}

export function createHistoryStore(opts: CreateHistoryStoreOptions): HistoryStore {
  const { path } = opts;
  const max = opts.max ?? 500;

  const readRaw = (): string[] => {
    if (!existsSync(path)) return [];
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.filter((e): e is string => typeof e === 'string');
    } catch {
      return [];
    }
  };

  return {
    path,
    load(): string[] {
      return readRaw().slice(-max);
    },
    append(entry: string): void {
      const history = readRaw();
      if (history[history.length - 1] === entry) return;
      history.push(entry);
      const trimmed = history.length > max ? history.slice(-max) : history;
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf-8');
      } catch { /* best-effort */ }
    },
  };
}
