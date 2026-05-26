import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export { formatError, parseArgs } from 'mu-core';

function isInside(child: string, parent: string): boolean {
  if (child === parent) return true;
  const rel = relative(parent, child);
  if (rel === '' || rel === '.') return true;
  if (rel.startsWith('..') || isAbsolute(rel)) return false;
  // relative() may return ".." without separator on direct escape
  return !rel.split(sep).includes('..');
}

// Walk parents until one exists, so write targets can still be validated.
function closestExisting(p: string): string {
  let current = p;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

/**
 * Sanitize a file path from LLM arguments.
 * Local models often wrap paths in extra quotes or add whitespace.
 *
 * When `cwd` is supplied, relative paths are resolved against it instead of
 * `process.cwd()` — this lets the agent operate on a different working
 * directory than the host process.
 *
 * `restrictToCwd` (opt-in) enforces that the resolved path stays inside
 * the cwd boundary, including after symlink resolution. Returns `null`
 * when the path escapes — callers must surface a tool error.
 */
export function sanitizePath(raw: string, cwd?: string, restrictToCwd = false): string | null {
  let p = raw.trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1).trim();
  }
  if (!isAbsolute(p)) {
    p = resolve(cwd ?? process.cwd(), p);
  }
  if (restrictToCwd && cwd) {
    const normalizedCwd = resolve(cwd);
    if (!isInside(p, normalizedCwd)) {
      return null;
    }
    // Resolve symlinks anywhere along the chain to defeat <cwd>/link -> /etc escapes.
    let realCwd: string;
    try {
      realCwd = realpathSync(normalizedCwd);
    } catch {
      realCwd = normalizedCwd;
    }
    const anchor = closestExisting(p);
    let realAnchor: string;
    try {
      realAnchor = realpathSync(anchor);
    } catch {
      return null;
    }
    const tail = relative(anchor, p);
    const realPath = tail === '' ? realAnchor : resolve(realAnchor, tail);
    if (!isInside(realAnchor, realCwd) || !isInside(realPath, realCwd)) {
      return null;
    }
    return realPath;
  }
  return p;
}
