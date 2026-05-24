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
 * surface a tool error.
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
    if (p !== normalizedCwd && !p.startsWith(`${normalizedCwd}/`)) {
      return null;
    }
  }
  return p;
}

/**
 * Parse a stringified JSON args payload from the LLM. Tools receive
 * `args: string` per the mu-core contract. Returns the parsed object or
 * throws — callers should let it propagate so `Tool.onError` can format it.
 */
export function parseArgs(args: string): Record<string, unknown> {
  if (!args || args.trim() === '') return {};
  const parsed = JSON.parse(args);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool arguments must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Normalize an unknown thrown value into a `Tool.onError` string.
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) return `Error: ${error.message}`;
  return `Error: ${String(error)}`;
}
