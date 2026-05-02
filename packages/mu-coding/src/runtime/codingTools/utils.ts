import { isAbsolute, resolve } from 'node:path';

/**
 * Sanitize a file path from LLM arguments.
 * Local models often wrap paths in extra quotes or add whitespace.
 *
 * When `cwd` is supplied, relative paths are resolved against it instead of
 * `process.cwd()` — this lets the agent operate on a different working
 * directory than the host process (the host passes its `PluginContext.cwd`
 * into the builtin plugin factory at activation time).
 */
export function sanitizePath(raw: string, cwd?: string): string {
  let p = raw.trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1).trim();
  }
  if (cwd && !isAbsolute(p)) {
    return resolve(cwd, p);
  }
  return p;
}
