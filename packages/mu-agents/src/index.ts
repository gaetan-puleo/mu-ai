export type {
  ApprovalChannel,
  ApprovalGateway,
  ApprovalGatewayRequestInput,
  ApprovalRequest,
  ApprovalResult,
} from './approval';
// Approval gateway (commit 3)
export { createApprovalGateway } from './approval';
export { DEFAULT_PRIMARY_AGENTS, DEFAULT_SUB_AGENTS } from './builtin';
export { AgentManager } from './manager';
export { loadAgentFile, loadAgentsFromDir, mergeAgents } from './markdown';
export type { Action, PermissionContext, PermissionMap, ToolMatchKeySpec, ToolPermission } from './permissions';

// Permissions (commit 3)
export { resolvePermission, validatePermissionMap } from './permissions';
export {
  AGENT_MESSAGE_TYPES,
  type AgentsPluginConfig,
  createAgentsPlugin,
  createAgentsPlugin as default,
} from './plugin';
export type { AgentSourceManager, AgentSourceRegistry } from './sources';
// Agent source manager (commit 3)
export { createAgentSourceManager } from './sources';
export { runSubagent } from './subagent';
export type { AgentDefinition, AgentSettings } from './types';
