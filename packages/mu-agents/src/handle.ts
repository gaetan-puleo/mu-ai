/**
 * Typed accessor for the mu-agents plugin.
 *
 * `registry.getPlugin('mu-agents')` returns `Plugin | undefined` with no
 * info about the runtime shape mu-agents publishes. This module gives
 * hosts a single, typed entry point so call sites stop hand-rolling
 * `as unknown as MuAgentsHandle` casts.
 *
 * Keep the published surface narrow: only what hosts actually consume.
 */

import type { PluginRegistry } from 'mu-core';
import type { ApprovalGateway } from './approval';
import type { SubagentRunRegistry } from './subagentRun';
import type { AgentDefinition } from './types';

/** What we expect mu-agents to expose at runtime. */
export interface MuAgentsManager {
  getActive?: () => AgentDefinition | undefined;
  getPrimary?: () => AgentDefinition[];
  getSubagents?: () => AgentDefinition[];
  setActive?: (id: string) => boolean;
  onChange?: (listener: (active: AgentDefinition | undefined) => void) => () => void;
}

export interface MuAgentsHandle {
  manager?: MuAgentsManager;
  approvalGateway?: ApprovalGateway;
  runs?: SubagentRunRegistry;
}

/** Look up the mu-agents plugin. Returns `undefined` if absent. */
export function getMuAgents(registry: PluginRegistry): MuAgentsHandle | undefined {
  return registry.getPlugin('mu-agents') as MuAgentsHandle | undefined;
}

/** Current active primary agent id, or `null` if none. */
export function getActiveAgentId(registry: PluginRegistry): string | null {
  const active = getMuAgents(registry)?.manager?.getActive?.();
  return active?.name ?? null;
}

export interface AgentListItem {
  id: string;
  description: string;
  type: 'primary' | 'subagent';
  color?: string;
}

/** Build the agent list emitted on the wire (primary + subagents). */
export function listAgents(registry: PluginRegistry): AgentListItem[] {
  const mu = getMuAgents(registry);
  if (!mu?.manager) return [];

  const primary = mu.manager.getPrimary?.() ?? [];
  const subagents = mu.manager.getSubagents?.() ?? [];
  return [...primary, ...subagents].map((a) => ({
    id: a.name,
    description: a.description ?? '',
    type: a.type,
    color: a.color,
  }));
}

/**
 * Subscribe to mu-agents active-agent changes. Returns a no-op
 * unsubscribe when the plugin or onChange isn't available.
 */
export function subscribeActiveAgent(registry: PluginRegistry, listener: (agentId: string | null) => void): () => void {
  const mu = getMuAgents(registry);
  const subscribe = mu?.manager?.onChange;
  if (!(subscribe && mu?.manager)) {
    return (): void => {
      // nothing to unsubscribe — no-op
    };
  }
  return subscribe.call(mu.manager, (active) => listener(active?.name ?? null));
}
