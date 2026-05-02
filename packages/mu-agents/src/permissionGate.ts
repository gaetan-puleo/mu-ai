/**
 * Shared permission-enforcement logic. Used by both the parent agent's
 * `beforeToolExec` hook (inside `plugin.tsx`) and the nested subagent loop
 * (`subagent.ts`), so an `ask` rule on a subagent's tool surfaces through
 * the same approval channel as a primary-agent `ask` would.
 *
 * Decoupled from `plugin.tsx` to avoid the subagent shim having to depend
 * on internal plugin state — callers pass the agent definition + the
 * registry view + the gateway explicitly.
 */

import type { PluginRegistryView, ToolCall } from 'mu-core';
import type { ApprovalGateway } from './approval';
import { resolvePermission } from './permissions';
import type { AgentDefinition } from './types';

export interface PermissionGateInput {
  agent: AgentDefinition;
  registry: PluginRegistryView | null;
  approvalGateway: ApprovalGateway;
  approvalChannelId: string;
  call: ToolCall;
}

export type PermissionGateOutcome =
  | ToolCall
  | {
      blocked: true;
      error: true;
      content: string;
    };

function safeParseArgs(call: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.function.arguments) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function findToolMatchKey(
  registry: PluginRegistryView | null,
  toolName: string,
): ((args: Record<string, unknown>) => string | undefined) | undefined {
  if (!registry) return undefined;
  const tool = registry.getTools().find((t) => t.definition.function.name === toolName);
  return tool?.permission?.matchKey;
}

export async function enforceAgentPermissions(input: PermissionGateInput): Promise<PermissionGateOutcome> {
  const { agent, registry, approvalGateway, approvalChannelId, call } = input;
  const toolName = call.function.name;
  const allowedByList = agent.tools.includes('*') || agent.tools.includes(toolName);

  // If the agent has a structured permission map, use it. Otherwise fall
  // back to the legacy whitelist-only check.
  if (agent.permissions) {
    const rule = agent.permissions[toolName];
    const args = safeParseArgs(call);
    const matchKey = findToolMatchKey(registry, toolName);
    const action = resolvePermission(rule, { toolName, args, matchKey });
    if (action === 'allow') return call;
    if (action === 'deny') {
      return {
        blocked: true,
        error: true,
        content: `Tool '${toolName}' denied by agent '${agent.name}' permissions.`,
      };
    }
    // action === 'ask' — consult approval gateway.
    const result = await approvalGateway.request({
      agentId: agent.name,
      toolName,
      toolArgs: args,
      channelId: approvalChannelId,
    });
    if (result === 'approved') return call;
    return {
      blocked: true,
      error: true,
      content: result === 'timeout' ? `Tool '${toolName}' approval timed out.` : `Tool '${toolName}' denied by user.`,
    };
  }

  // Legacy path: whitelist gating only — never `ask`.
  if (allowedByList) return call;
  return {
    blocked: true,
    error: true,
    content: `Tool '${toolName}' is not allowed in agent '${agent.name}'. Allowed: ${agent.tools.join(', ') || 'none'}.`,
  };
}
