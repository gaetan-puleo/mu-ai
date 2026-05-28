export { type AgentRuntime, type AgentRuntimeConfig, createAgentRuntime, type Model } from './agent-runtime';
export { type Roundtrip, type RoundtripListener, RoundtripStore } from './roundtrips';
export { bootstrap, type BootstrapOptions, type BootstrapResult } from './bootstrap';

// ── paths ────────────────────────────────────────────────────────────
export { createXdgPaths, type XdgPaths } from './paths/xdg';
export { createJsonStore, type CreateJsonStoreOptions, type JsonStore } from './paths/json-store';
export { createHistoryStore, type CreateHistoryStoreOptions, type HistoryStore } from './paths/history';

// ── approvals ────────────────────────────────────────────────────────
export {
  type ApprovalDecision,
  type ApprovalQueue,
  approvalQueueToPrompt,
  type ApprovalRequest,
  type ApprovalRequestMeta,
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
export {
  createSubAgentDispatcher,
  type CreateSubAgentDispatcherOptions,
  type DispatchSubAgentFn,
  type DispatchSubAgentResult,
} from './sub-agents/dispatcher';
export { filterToolsByPrimary, pickPrimaryAgent } from './sub-agents/primary';
export {
  createPrimaryAgentState,
  type PrimaryAgentState,
  type PrimaryAgentStateOptions,
} from './sub-agents/primary-state';
export {
  type AgentRouting,
  type NamedAgent,
  parseAgentRouting,
  type ParseAgentRoutingOptions,
} from './sub-agents/routing';
export type { SubAgent } from './sub-agents/types';

// ── mentions ─────────────────────────────────────────────────────────
export { createMentionEngine, type MentionEngine } from './mentions/engine';
export type { ExpandResult, MentionResolver, MentionResult, ResolvedMention } from './mentions/types';

// ── commands ─────────────────────────────────────────────────────────
export { isCommandLine, parseCommandLine, type ParsedCommand } from './commands/parser';
export {
  type Command,
  type CommandMatch,
  type CommandRegistry,
  type CommandResult,
  createCommandRegistry,
} from './commands/registry';
export {
  createDeferredCommandQueue,
  type CreateDeferredCommandQueueOptions,
  type DeferredCommandQueue,
} from './commands/deferred-queue';
export { createAgentsCommand, createHelpCommand, createSessionsCommand } from './commands/defaults';

// ── channels ─────────────────────────────────────────────────────────
export { type ChannelInListener, type ChannelManager, createChannelManager } from './channels/manager';
export { createTuiChannel, lineSourceFrom, type TuiChannelOptions } from './channels/tui';
export type { Channel, ChannelContext, ChannelInEvent, ChannelKind, ChannelOutEvent } from './channels/types';

// ── sessions ─────────────────────────────────────────────────────────
export { createJsonlSessionStore } from './sessions/jsonl-store';
export { createResumingStore } from './sessions/resuming-store';
export type { PersistedSessionStore, SessionSummary, StoreChangeKind } from './sessions/types';

// ── scheduler ────────────────────────────────────────────────────────
export {
  createSchedulerPlugin,
  type SchedulerEvent,
  type SchedulerOptions,
  type SchedulerTask,
} from './scheduler/plugin';

// ── plugins (install/uninstall) ──────────────────────────────────────
export { installLocalPluginFile, installNpmPlugin, PLUGIN_TRUST_WARNING } from './plugins/installer';
export {
  installAndRegister,
  type InstallRegisterOptions,
  type InstallRegisterResult,
  uninstallAndUnregister,
  type UninstallRegisterOptions,
  type UninstallRegisterResult,
} from './plugins/install-register';
export { type PickedProvider, type PickProviderOptions, pickProviderPlugin } from './plugins/provider-selection';

// ── base TUI primitives ──────────────────────────────────────────────
export {
  type BaseChatLine,
  buildStatusParts,
  createInputHistory,
  type CreateInputHistoryOptions,
  formatTokens,
  type InputHistory,
  spinnerFrame,
  statusFromEvent,
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
