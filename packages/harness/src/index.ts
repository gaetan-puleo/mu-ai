export {
  type AgentRuntime,
  type AgentRuntimeConfig,
  createAgentRuntime,
  type Model,
} from './agent-runtime';
export {
  type Roundtrip,
  type RoundtripListener,
  RoundtripStore,
} from './roundtrips';
export { bootstrap, type BootstrapOptions, type BootstrapResult } from './bootstrap';

// ── paths ────────────────────────────────────────────────────────────
export { createXdgPaths, type XdgPaths } from './paths/xdg';

// ── approvals ────────────────────────────────────────────────────────
export {
  type ApprovalDecision,
  type ApprovalQueue,
  type ApprovalRequest,
  type ApprovalRequestMeta,
  approvalQueueToPrompt,
  createApprovalQueue,
} from './approvals/queue';

// ── permissions ──────────────────────────────────────────────────────
export { createPermissionRegistry, type PermissionRegistry } from './permissions/registry';
export {
  createPermissionHook,
  type PermissionHookOptions,
  type PermissionPrompt,
  type PermissionPromptMeta,
} from './permissions/hook';
export type {
  PermissionCheck,
  PermissionConfig,
  PermissionDecision,
  PermissionResult,
  PermissionRule,
} from './permissions/types';

// ── skills ───────────────────────────────────────────────────────────
export { formatSkillInvocation, formatSkillsForSystemPrompt } from './skills/system-prompt';
export { type Skill } from './skills/types';

// ── sub-agents ───────────────────────────────────────────────────────
export { runSubAgent, type RunSubAgentOptions, type SubAgentRunResult } from './sub-agents/runner';
export {
  createSubAgentParallelTool,
  createSubAgentTool,
  formatSubAgentReplyForParent,
  type SubAgentToolDeps,
} from './sub-agents/tool';
export { filterToolsByPrimary, pickPrimaryAgent } from './sub-agents/primary';
export type { SubAgent } from './sub-agents/types';

// ── mentions ─────────────────────────────────────────────────────────
export { createMentionEngine, type MentionEngine } from './mentions/engine';
export type {
  ExpandResult,
  MentionResolver,
  MentionResult,
  ResolvedMention,
} from './mentions/types';

// ── channels ─────────────────────────────────────────────────────────
export { type ChannelInListener, type ChannelManager, createChannelManager } from './channels/manager';
export { createTuiChannel, lineSourceFrom, type TuiChannelOptions } from './channels/tui';
export type { Channel, ChannelContext, ChannelInEvent, ChannelKind, ChannelOutEvent } from './channels/types';

// ── sessions ─────────────────────────────────────────────────────────
export { createJsonlSessionStore } from './sessions/jsonl-store';
export type { PersistedSessionStore, SessionSummary, StoreChangeKind } from './sessions/types';

// ── scheduler ────────────────────────────────────────────────────────
export {
  createSchedulerPlugin,
  type SchedulerEvent,
  type SchedulerOptions,
  type SchedulerTask,
} from './scheduler/plugin';

// ── plugins (install/uninstall) ──────────────────────────────────────
export {
  installLocalPluginFile,
  installNpmPlugin,
  PLUGIN_TRUST_WARNING,
} from './plugins/installer';

// ── base TUI primitives ──────────────────────────────────────────────
export {
  type BaseChatLine,
  buildStatusParts,
  formatTokens,
  spinnerFrame,
  type StatusParts,
  type SubAgentRun,
  type SubAgentRunListener,
  type SubAgentRunStatus,
  SubAgentRunStore,
  type SubAgentTranscriptEntry,
  type ToolCallFormatter,
  TranscriptModel,
  type TranscriptOptions,
  type UserChatLine,
} from './tui';
