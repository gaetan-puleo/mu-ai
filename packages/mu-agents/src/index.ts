export type { Agent } from './markdown';
export { loadAgentFile, loadAgentsFromDir } from './markdown';

export type { Action, PermissionMap, ResolvedAction, ToolPermission } from './permissions';
export { parsePermissions, resolveAction } from './permissions';

export type {
  ApprovalChannel,
  ApprovalDecision,
  ApprovalRequest,
} from './approval';
export { ApprovalGateway } from './approval';

export type { SubAgentEvent, SubAgentEventType, SubAgentBus } from './subAgentBus';
export { createSubAgentBus } from './subAgentBus';

export type { SwitchEvent, SwitchReason, SwitchTracker } from './switches';
export { createSwitchTracker } from './switches';

export type { MentionCompletion, ParsedMention } from './mention';
export { createAgentCompletions, parseMention } from './mention';

export type { SubAgentResult, SubAgentRunOptions } from './subagent';
export { runSubAgent, createSubagentTool, createSubagentParallelTool } from './subagent';

export type { AgentsHandle, AgentsPluginOptions } from './plugin';
export { contributeAgentsDir, createAgentsPlugin, default } from './plugin';
