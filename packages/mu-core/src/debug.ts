import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Append-only debug logger. No-op unless `MU_DEBUG=1` (or any truthy value).
 *
 * Logs land in `~/.cache/mu/debug.log` (or `$XDG_CACHE_HOME/mu/debug.log`).
 * The path is computed lazily on first call so importing this module has
 * zero cost when debugging is off.
 *
 * Format: `<ISO timestamp> <subsystem> <event> [key=value ...]`
 *
 * Strings are written verbatim. Multi-line values aren't escaped — keep
 * them short. Mostly useful for numeric fields like content.length.
 */

let cachedPath: string | null = null;
let warned = false;

function debugEnabled(): boolean {
  const v = process.env.MU_DEBUG;
  return !!v && v !== '0' && v !== 'false';
}

function logPath(): string {
  if (cachedPath) return cachedPath;
  const base = process.env.XDG_CACHE_HOME
    ? join(process.env.XDG_CACHE_HOME, 'mu')
    : join(homedir(), '.cache', 'mu');
  cachedPath = join(base, 'debug.log');
  try {
    mkdirSync(dirname(cachedPath), { recursive: true });
  } catch {
    /* ignore — appendFile will surface a more useful error */
  }
  return cachedPath;
}

export function debugLog(subsystem: string, event: string, fields?: Record<string, unknown>): void {
  if (!debugEnabled()) return;
  const parts: string[] = [new Date().toISOString(), subsystem, event];
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      parts.push(`${k}=${formatValue(v)}`);
    }
  }
  try {
    appendFileSync(logPath(), `${parts.join(' ')}\n`);
  } catch (err) {
    if (!warned) {
      warned = true;
      process.stderr.write(
        `[mu-debug] failed to write log: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

function formatValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undef';
  if (typeof v === 'string') {
    // Truncate huge strings — we mostly log lengths anyway. Keep first 80 chars
    // so we don't pollute the log with a 4KB assistant reply.
    if (v.length > 80) return JSON.stringify(`${v.slice(0, 77)}...`);
    return JSON.stringify(v);
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
