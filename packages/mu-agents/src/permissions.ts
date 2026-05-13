export type Action = 'allow' | 'deny' | 'ask';

/**
 * Minimal glob matcher for permission rules. Supports `*` (any characters,
 * including slashes — commands/URLs are opaque strings, not paths) and `?`
 * (single character). Anchored: the pattern must match the entire input.
 */
export function globMatch(input: string, pattern: string): boolean {
  // Escape regex metacharacters except our two glob wildcards.
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${re}$`, 's').test(input);
}

/** Permission rule for one tool. Either a single action, or globs → action. */
export type ToolPermission = Action | Record<string, Action>;

/** Map of tool name → its permission rule. */
export type PermissionMap = Record<string, ToolPermission>;

export interface ResolvedAction {
  action: Action;
  /** The pattern that matched ('*' if fallback or no globs). */
  rule: string;
}

function isAction(v: unknown): v is Action {
  return v === 'allow' || v === 'deny' || v === 'ask';
}

/**
 * Resolve a permission rule against an arg's match-key.
 *
 *   - Shorthand `'allow' | 'deny' | 'ask'` → applies to everything.
 *   - Glob map: walk in declaration order, first match wins. `'*'` is the fallback.
 *   - No matchKey + glob map: use `'*'` fallback, else `deny`.
 */
export function resolveAction(perm: ToolPermission, matchKey: string | undefined): ResolvedAction {
  if (typeof perm === 'string') return { action: perm, rule: '*' };

  if (matchKey === undefined) {
    const fallback = perm['*'];
    return { action: isAction(fallback) ? fallback : 'deny', rule: '*' };
  }

  for (const [pattern, action] of Object.entries(perm)) {
    if (!isAction(action)) continue;
    if (pattern === '*' || globMatch(matchKey, pattern)) {
      return { action, rule: pattern };
    }
  }
  return { action: 'deny', rule: 'no-match' };
}

/**
 * Parse the YAML `tools:` frontmatter into a typed PermissionMap + simple
 * allow-list. Accepts:
 *
 *   - undefined / null         → allow everything (`tools: ['*']`)
 *   - string  "a, b, c"        → allow-list of those names
 *   - array   ['a', 'b']       → allow-list
 *   - object  { bash: 'allow', read: { '*': 'ask' } }
 *
 * The allow-list is derived by including any tool whose effective rule isn't
 * a hard `'deny'`.
 */
export function parsePermissions(raw: unknown): {
  permissions: PermissionMap | undefined;
  allowList: string[];
} {
  if (raw === undefined || raw === null) {
    return { permissions: undefined, allowList: ['*'] };
  }

  if (typeof raw === 'string') {
    const list = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return { permissions: undefined, allowList: list };
  }

  if (Array.isArray(raw)) {
    return { permissions: undefined, allowList: raw.map(String).filter(Boolean) };
  }

  if (typeof raw === 'object') {
    const permissions: PermissionMap = {};
    const allowList: string[] = [];
    for (const [tool, rule] of Object.entries(raw as Record<string, unknown>)) {
      const normalised = normaliseToolPermission(rule);
      if (normalised === null) continue;
      permissions[tool] = normalised;
      if (normalised !== 'deny') allowList.push(tool);
    }
    return { permissions, allowList };
  }

  return { permissions: undefined, allowList: ['*'] };
}

function normaliseToolPermission(raw: unknown): ToolPermission | null {
  if (isAction(raw)) return raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, Action> = {};
    for (const [glob, action] of Object.entries(raw as Record<string, unknown>)) {
      if (isAction(action)) out[glob] = action;
    }
    return out;
  }
  return null;
}
