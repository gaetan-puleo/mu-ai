export type {
  ApprovalChannel,
  ApprovalGateway,
  ApprovalGatewayRequestInput,
  ApprovalRequest,
  ApprovalResult,
  ApprovalSnapshot,
  ApprovalSnapshotListener,
} from './approval';
export { createApprovalGateway } from './approval';
export { DEFAULT_PRIMARY_AGENTS, DEFAULT_SUB_AGENTS } from './builtin';
export type { AgentListItem, MuAgentsHandle, MuAgentsManager } from './handle';
export { getActiveAgentId, getMuAgents, listAgents, subscribeActiveAgent } from './handle';
export { AgentManager } from './manager';
export { loadAgentFile, loadAgentsFromDir, mergeAgents } from './markdown';
export type { Action, PermissionContext, PermissionMap, ToolMatchKeySpec, ToolPermission } from './permissions';

// Permissions (commit 3)
export { resolvePermission, validatePermissionMap } from './permissions';
export { AGENT_MESSAGE_TYPES } from './messageTypes';
export {
  type AgentsPluginConfig,
  createAgentsPlugin,
  createAgentsPlugin as default,
} from './plugin';

export type { AgentSourceManager, AgentSourceRegistry } from './sources';
// Agent source manager (commit 3)
export { createAgentSourceManager } from './sources';
export { runSubagent } from './subagent';
export type {
  SessionWriter,
  SubAgentRunSnapshot,
  SubagentRegistryListener,
  SubagentRun,
  SubagentRunListener,
  SubagentRunRegistry,
  SubagentSnapshotListener,
  SubagentStatus,
} from './subagentRun';
export { createSubagentRunRegistry } from './subagentRun';
export type {
  SubAgentBus,
  SubAgentEvent,
  SubAgentEventKind,
} from './subAgentBus';
export { createSubAgentBus } from './subAgentBus';
export type { AgentDefinition, AgentSettings } from './types';
export { capitalizeAgentName } from './utils/displayName';
