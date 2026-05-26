import type { BeforeToolHook } from 'mu-core';
import type { PermissionRegistry } from './registry';
import type { PermissionCheck, PermissionRule } from './types';

export interface PermissionPromptMeta {
  /** Sub-agent that triggered the call, if any. Set by `runSubAgent`. */
  agent?: string;
}

/**
 * Asks the host whether to allow a tool call that the static config could
 * not decide automatically. The host can show a TUI dialog, send an RPC
 * request, defer to a policy, etc. Must resolve to `allow` or `deny`.
 *
 * The optional `meta` carries provenance (e.g. originating sub-agent) so the
 * host can attribute concurrent approval prompts.
 */
export type PermissionPrompt = (
  call: PermissionCheck,
  matched?: PermissionRule,
  meta?: PermissionPromptMeta,
) => Promise<'allow' | 'deny'>;

export interface PermissionHookOptions {
  registry: PermissionRegistry;
  /** Called when the registry decision is `ask`. If absent, asks default to deny. */
  prompt?: PermissionPrompt;
}

/**
 * Build a BeforeToolHook that gates tool calls by the permission registry.
 *
 *  - `allow` → tool runs normally
 *  - `deny`  → tool execution is blocked, runtime substitutes a denial result
 *  - `ask`   → delegates to `prompt`; missing prompt resolves to deny
 */
export function createPermissionHook({ registry, prompt }: PermissionHookOptions): BeforeToolHook {
  return async ({ tool, args }) => {
    const result = registry.check({ tool: tool.name, args });

    if (result.decision === 'allow') return undefined;
    if (result.decision === 'deny') {
      return { block: true, reason: `permission denied for ${tool.name}${formatRule(result.matched)}` };
    }

    // ask
    if (!prompt) {
      return { block: true, reason: `permission required for ${tool.name} (no prompt handler configured)` };
    }
    const userDecision = await prompt({ tool: tool.name, args }, result.matched);
    // Treat anything that is not an explicit `allow` as a denial to fail closed.
    if (userDecision !== 'allow') {
      return { block: true, reason: `user denied ${tool.name}` };
    }
    return undefined;
  };
}

function formatRule(rule: PermissionRule | undefined): string {
  if (!rule) return '';
  const args = rule.argsPattern ? `(${rule.argsPattern})` : '';
  return ` (rule: ${rule.tool}${args})`;
}
