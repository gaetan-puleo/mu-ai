import { isAbsolute, resolve } from 'node:path';

/**
 * Sanitize a file path from LLM arguments.
 * Local models often wrap paths in extra quotes or add whitespace.
 *
 * When `cwd` is supplied, relative paths are resolved against it instead of
 * `process.cwd()` — this lets the agent operate on a different working
 * directory than the host process.
 *
 * `restrictToCwd` (opt-in) enforces that the resolved path stays inside
 * the cwd boundary. Returns `null` when the path escapes — callers must
 * surface a tool error. mu-coding doesn't enable this (allows absolute
 * paths to anywhere); arya does, for permission-glob safety.
 */
export function sanitizePath(raw: string, cwd?: string, restrictToCwd = false): string | null {
  let p = raw.trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1).trim();
  }
  if (cwd && !isAbsolute(p)) {
    p = resolve(cwd, p);
  }
  if (restrictToCwd && cwd) {
    if (!p.startsWith(`${cwd}/`) && p !== cwd) {
      return null;
    }
  }
  return p;
}
