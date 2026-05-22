/**
 * Pure formatters used by the transcript renderer in `tui.tsx`. Lives in a
 * separate module so unit tests can exercise them without booting Ink (the
 * .tsx entry point pulls in ink, mu-core, etc. and is not test-friendly).
 *
 * The two helpers here are deliberately tiny and side-effect-free:
 *   - `formatToolCallArgs` — extract VALUES from a JSON-parsed args object
 *     (no keys, no braces), comma-joined, truncated. Mirrors how a user
 *     reads a shell command in the chat: `▸ bash(ls -la)`, not
 *     `▸ bash({"command":"ls -la"})`.
 *   - `formatToolResultPreview` — pick the first non-empty line of the
 *     tool result and truncate it to one row.
 */

/**
 * Truncate `s` to at most `maxLen` characters. When truncated, the final
 * character is replaced with the ellipsis "…" so the boundary is visible
 * without adding length.
 */
export function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1))}…`;
}

/**
 * Format a single tool call's arguments for inline display. We show the
 * VALUES of each JSON-parsed argument, comma-joined, NOT the full JSON
 * object. e.g. for `bash({"command":"ls -la"})` we render `ls -la`; for
 * `read({"path":"/x","limit":100})` we render `/x, 100`.
 *
 * Falls back to the raw `arguments` string when the JSON does not parse
 * (truncated streams, broken provider output, …).
 *
 * Walks the object's own enumerable keys in declaration order — same
 * order JSON.parse preserves for ES2015+. Object/array values are
 * JSON-stringified compactly (they're typically small, e.g. flag arrays);
 * strings render raw; numbers/booleans use their natural toString.
 * `undefined` entries are skipped (LLMs sometimes emit them).
 */
export function formatToolCallArgs(rawArguments: string, maxLen = 120): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    return truncate(rawArguments, maxLen);
  }
  if (parsed === null || typeof parsed !== 'object') {
    return truncate(String(parsed ?? ''), maxLen);
  }
  const parts: string[] = [];
  for (const [, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (v === undefined) continue;
    if (typeof v === 'string') parts.push(v);
    else parts.push(JSON.stringify(v));
  }
  return truncate(parts.join(', '), maxLen);
}

/**
 * Pick the first non-empty line of `content` and truncate it. Used for
 * the inline tool-result preview row. Returns an empty string when the
 * content has no visible lines.
 */
export function formatToolResultPreview(content: string, maxLen = 200): string {
  if (!content) return '';
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return truncate(trimmed, maxLen);
  }
  return '';
}
