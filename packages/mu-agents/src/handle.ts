/**
 * Typed accessor for the mu-agents plugin.
 *
 * Provides a typed entry point so hosts stop hand-rolling casts.
 * All agent access is session-scoped — no global `getActive()`.
 */

import type { ChatMessage, PluginRegistry } from 'mu-core';
import type { ApprovalGateway } from './approval';
import type { SubagentRunRegistry } from './subagentRun';
import type { AgentDefinition } from './types';

export interface MuAgentsManager {
  getActiveFor: (sessionId: string | null) => AgentDefinition | undefined;
  getPrimary?: () => AgentDefinition[];
  getSubagents?: () => AgentDefinition[];
  setActiveFor: (name: string, sessionId: string | null) => boolean;
  cycle?: () => AgentDefinition | undefined;
  onChange?: (listener: (active: AgentDefinition | undefined, sessionId: string | null) => void) => () => void;
  onAgentsChanged?: (
    listener: (snapshot: { primary: AgentDefinition[]; subagent: AgentDefinition[] }) => void,
  ) => () => void;
}

export interface MuAgentsHandle {
  manager?: MuAgentsManager;
  approvalGateway?: ApprovalGateway;
  runs?: SubagentRunRegistry;
}

export function getMuAgents(registry: PluginRegistry): MuAgentsHandle | undefined {
  return registry.getPlugin('mu-agents') as MuAgentsHandle | undefined;
}

/**
 * Active agent id for a session. Pass `null` for the global default.
 */
export function getActiveAgentId(registry: PluginRegistry, sessionId: string | null = null): string | null {
  const active = getMuAgents(registry)?.manager?.getActiveFor(sessionId);
  return active?.name ?? null;
}

export interface AgentListItem {
  id: string;
  description: string;
  type: 'primary' | 'subagent';
  color?: string;
}

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

export function resolveAgentInfo(registry: PluginRegistry, name: string): AgentListItem | undefined {
  if (!name) return undefined;
  return listAgents(registry).find((a) => a.id === name);
}

export interface MessageAuthor {
  id: string;
  description?: string;
  color?: string;
}

export interface AuthoredMessage extends ChatMessage {
  author?: MessageAuthor;
}

export function enrichMessageAuthor(msg: ChatMessage, registry: PluginRegistry): AuthoredMessage {
  const agentName = msg.meta?.agent;
  if (!agentName) return msg;
  const found = resolveAgentInfo(registry, agentName);
  if (!found) return { ...msg, author: { id: agentName } };
  const author: MessageAuthor = { id: found.id };
  if (found.description) author.description = found.description;
  if (found.color) author.color = found.color;
  return { ...msg, author };
}

export function subscribeActiveAgent(
  registry: PluginRegistry,
  listener: (agentId: string | null, sessionId: string | null) => void,
): () => void {
  const mu = getMuAgents(registry);
  const subscribe = mu?.manager?.onChange;
  if (!(subscribe && mu?.manager)) {
    return (): void => {};
  }
  return subscribe.call(mu.manager, (active, sessionId) => listener(active?.name ?? null, sessionId));
}

export function subscribeAgentsList(registry: PluginRegistry, listener: (agents: AgentListItem[]) => void): () => void {
  const mu = getMuAgents(registry);
  const subscribe = mu?.manager?.onAgentsChanged;
  if (!(subscribe && mu?.manager)) {
    return (): void => {};
  }
  return subscribe.call(mu.manager, () => {
    listener(listAgents(registry));
  });
}
