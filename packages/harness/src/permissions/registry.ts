import { matchArgs, matchTool } from './glob';
import type {
  PermissionCheck,
  PermissionConfig,
  PermissionDecision,
  PermissionResult,
  PermissionRule,
} from './types';

export interface PermissionRegistry {
  check(call: PermissionCheck): PermissionResult;
}

/**
 * Precedence among matching rules: `deny` > `ask` > `allow`. If no rule
 * matches, falls back to `config.default`.
 */
export function createPermissionRegistry(config: PermissionConfig): PermissionRegistry {
  return {
    check({ tool, args }) {
      const matches = config.rules.filter((rule) => matchTool(rule.tool, tool) && matchArgs(rule.argsPattern, args));
      const winner = pickByPrecedence(matches);
      if (winner) return { decision: winner.decision, matched: winner };
      return { decision: config.default };
    },
  };
}

function pickByPrecedence(matches: PermissionRule[]): PermissionRule | undefined {
  const byPriority: PermissionDecision[] = ['deny', 'ask', 'allow'];
  for (const decision of byPriority) {
    const hit = matches.find((m) => m.decision === decision);
    if (hit) return hit;
  }
  return undefined;
}
