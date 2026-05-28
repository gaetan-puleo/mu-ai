/**
 * Tiny safe-JSON file store for host config / state files.
 *
 * `load()` returns the validated shape (or the validator's empty-object form)
 * when the file is missing or corrupt — hosts never crash on a broken file.
 * `save()` writes via the parent dir's mkdirSync so first-run hosts don't
 * have to pre-create the XDG layout.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface JsonStore<T> {
  readonly path: string;
  load(): T;
  save(value: T): void;
}

export interface CreateJsonStoreOptions<T> {
  path: string;
  /**
   * Validate / coerce the parsed JSON. Called with `{}` when the file is
   * absent or unreadable, so the validator also defines the empty shape.
   */
  validate: (obj: Record<string, unknown>) => T;
  /**
   * Optional channel for parse errors. Defaults to a `process.stderr.write`
   * with a `[<basename>]` prefix; pass `() => {}` to silence.
   */
  onParseError?: (path: string, error: unknown) => void;
}

export function createJsonStore<T>(opts: CreateJsonStoreOptions<T>): JsonStore<T> {
  const { path, validate } = opts;
  const onParseError = opts.onParseError ?? defaultOnParseError;

  return {
    path,
    load(): T {
      if (!existsSync(path)) return validate({});
      try {
        const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return validate({});
        return validate(raw as Record<string, unknown>);
      } catch (err) {
        onParseError(path, err);
        return validate({});
      }
    },
    save(value: T): void {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
    },
  };
}

function defaultOnParseError(path: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[mu-harness/json-store] failed to parse ${path}: ${msg}\n`);
}
