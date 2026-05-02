/**
 * Permission resolver for agent tool calls.
 *
 * A permission map looks like:
 *   tools:
 *     bash:
 *       "git *": allow
 *       "rm -rf *": deny
 *       "*": ask
 *     read_file: allow
 *     write_file:
 *       "**\/.env": deny
 *       "src/**": allow
 *     subagent: allow
 *
 * Each tool entry is either a direct action ('allow' | 'deny' | 'ask') or a
 * glob → action map. Glob form requires the tool to expose a `matchKey`
 * extractor (validated at load time, not at execution).
 */

import picomatch from 'picomatch';

export type Action = 'allow' | 'deny' | 'ask';

export type ToolPermission = Action | Record<string, Action>;

export type PermissionMap = Record<string, ToolPermission>;

export interface PermissionContext {
  toolName: string;
  args: Record<string, unknown>;
  /** Pulls the value to glob-match from the call args (e.g. cmd, path). */
  matchKey?: (args: Record<string, unknown>) => string | undefined;
}

const matcherCache = new WeakMap<
  Record<string, Action>,
  Array<{ glob: string; action: Action; isMatch: (s: string) => boolean }>
>();

function getMatchers(
  rule: Record<string, Action>,
): Array<{ glob: string; action: Action; isMatch: (s: string) => boolean }> {
  let cached = matcherCache.get(rule);
  if (!cached) {
    cached = Object.entries(rule).map(([glob, action]) => ({
      glob,
      action,
      isMatch: picomatch(glob, { dot: true }),
    }));
    matcherCache.set(rule, cached);
  }
  return cached;
}

/**
 * Resolve the action for a tool call given its permission rule.
 *
 *  - undefined rule (tool absent from map) → `'deny'`
 *  - direct string action → that action
 *  - object rule + matchKey → first matching glob in declared order; default `'deny'`
 *
 * The function is defensive on bad inputs (matchKey throws → `'deny'` with no
 * silent failure path).
 */
export function resolvePermission(rule: ToolPermission | undefined, ctx: PermissionContext): Action {
  if (rule === undefined) return 'deny';
  if (typeof rule === 'string') return rule;

  let key: string | undefined;
  try {
    key = ctx.matchKey?.(ctx.args);
  } catch {
    return 'deny';
  }
  if (key === undefined) return 'deny';

  for (const m of getMatchers(rule)) {
    if (m.isMatch(key)) return m.action;
  }
  return 'deny';
}

/**
 * Validate a permission map at load time. Throws on glob-form rules whose
 * tool has no `matchKey`. Returns nothing on success.
 */
export interface ToolMatchKeySpec {
  toolName: string;
  matchKey?: (args: Record<string, unknown>) => string | undefined;
}

export function validatePermissionMap(map: PermissionMap, knownTools: ToolMatchKeySpec[]): void {
  const byName = new Map(knownTools.map((t) => [t.toolName, t]));
  for (const [toolName, rule] of Object.entries(map)) {
    if (typeof rule === 'string') continue;
    const spec = byName.get(toolName);
    if (!spec) continue; // unknown tool — silently skip; agent loader may warn
    if (!spec.matchKey) {
      throw new Error(
        `Tool "${toolName}" has glob-form permissions but does not declare a matchKey extractor. ` +
          'Use the simple form (allow | deny | ask) for this tool.',
      );
    }
  }
}
