/**
 * Loads the mu-coding base system prompt.
 *
 * Resolution order (first existing, readable file wins):
 *   1. `$XDG_CONFIG_HOME/mu/SYSTEM.md` (or `~/.config/mu/SYSTEM.md`)
 *      — user override. Full replacement of the bundled identity.
 *   2. `<this package>/SYSTEM.md` — bundled default shipped with mu-coding.
 *
 * The returned string is wired into `Mu.start({ config.systemPrompt })` so
 * mu-core inserts it at the *start* of the composed system message, ahead
 * of plugin contributions (mu-tools tool-usage hint, etc.). Plugin
 * `api.systemPrompt(...)` contributions are NOT replaced — they are
 * orthogonal "how to use this capability" notes that always append.
 *
 * Errors (file present but unreadable, etc.) are logged to stderr with a
 * `[mu]` prefix and the loader falls through to the next candidate, then
 * to an empty string. We never throw — a missing/broken prompt should
 * never crash the TUI.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function userSystemPromptPath(): string {
  const dir = process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, 'mu') : join(homedir(), '.config', 'mu');
  return join(dir, 'SYSTEM.md');
}

/**
 * Locate the bundled SYSTEM.md. The file lives at the package root, so
 * from both `src/systemPrompt.ts` (dev / bun-from-source) and
 * `dist/systemPrompt.js` (built) it sits one directory up.
 */
function bundledSystemPromptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'SYSTEM.md');
}

function warn(msg: string): void {
  process.stderr.write(`[mu] ${msg}\n`);
}

function tryRead(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf-8').trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn(`failed to read ${path}: ${msg}`);
    return null;
  }
}

export function loadCodingSystemPrompt(): string {
  const override = tryRead(userSystemPromptPath());
  if (override !== null) return override;
  const bundled = tryRead(bundledSystemPromptPath());
  if (bundled !== null) return bundled;
  return '';
}
