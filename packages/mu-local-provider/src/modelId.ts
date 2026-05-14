/**
 * Model identifier parsing and formatting.
 *
 * Canonical form is a hierarchical triple:
 *
 *     local/<serverKind>/<modelId>
 *
 * e.g. `local/llama-swap/qwen-3.6-35b`. The provider accepts three input
 * shapes for backwards compatibility / ergonomics and normalises them all
 * to the canonical form:
 *
 *  1. `qwen-3.6-35b`                        — legacy short id (no routing)
 *  2. `llama-swap/qwen-3.6-35b`             — kind-qualified
 *  3. `local/llama-swap/qwen-3.6-35b`       — fully qualified
 *
 * Anything with MORE than three segments preserves the trailing portion
 * as the model id — some llama-server setups expose gguf filenames with
 * slashes is theoretically possible. Be permissive on read, strict on
 * write.
 */

import type { LocalServerKind } from './detect';

export const PROVIDER_PREFIX = 'local';

export interface ParsedModelId {
  /** Always `'local'` in the canonical form. */
  provider: string;
  /** Detected (or asserted) server kind. May be `undefined` when only a bare model id was supplied. */
  kind?: LocalServerKind | string;
  /** The trailing model identifier the server itself knows about. */
  id: string;
}

const KNOWN_KINDS: ReadonlyArray<LocalServerKind> = ['llama-swap', 'llama-cpp', 'unknown'];
const KNOWN_KIND_SET = new Set<string>(KNOWN_KINDS);

/**
 * Parse a model identifier from any of the three accepted forms.
 *
 * Heuristic for two-segment input (`a/b`):
 *   - If `a` is a known server kind → treat as kind-qualified.
 *   - Otherwise → treat the whole string as a bare id with a slash in it.
 *
 * Heuristic for three-or-more-segment input (`a/b/c[...]`):
 *   - If `a === 'local'` AND `b` is a known kind → fully qualified;
 *     the model id is `c` and beyond, joined with `/`.
 *   - Otherwise → treat the whole string as a bare id.
 *
 * The "otherwise" branches are conservative: when we can't be sure the
 * segments are routing tokens we keep them in the id rather than
 * silently dropping data.
 */
export function parseModelId(raw: string): ParsedModelId {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { provider: PROVIDER_PREFIX, id: '' };
  }
  const segments = trimmed.split('/');
  if (segments.length === 1) {
    return { provider: PROVIDER_PREFIX, id: segments[0]! };
  }
  if (segments.length === 2) {
    const [a, b] = segments as [string, string];
    if (KNOWN_KIND_SET.has(a)) {
      return { provider: PROVIDER_PREFIX, kind: a as LocalServerKind, id: b };
    }
    return { provider: PROVIDER_PREFIX, id: trimmed };
  }
  // 3+ segments
  const [a, b, ...rest] = segments;
  if (a === PROVIDER_PREFIX && b && KNOWN_KIND_SET.has(b)) {
    return { provider: PROVIDER_PREFIX, kind: b as LocalServerKind, id: rest.join('/') };
  }
  return { provider: PROVIDER_PREFIX, id: trimmed };
}

/**
 * Format a parsed (or freshly constructed) identifier as the canonical
 * triple. When `kind` is missing, falls back to `unknown` so the output
 * is always well-formed (callers that want a shorter rendering should
 * project the result themselves).
 */
export function formatModelId(parsed: { kind?: LocalServerKind | string; id: string }): string {
  const kind = parsed.kind ?? 'unknown';
  return `${PROVIDER_PREFIX}/${kind}/${parsed.id}`;
}

/**
 * Extract just the bare model id (the trailing segment) that the
 * underlying server actually knows about. Used when issuing chat
 * completions where the provider must send the unadorned id over the
 * wire — the OpenAI server has no notion of our prefix.
 */
export function bareModelId(raw: string): string {
  return parseModelId(raw).id;
}
