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
export { loadPlugins, type LoadPluginsOptions } from './plugin-loader';
export { createHostConfig, type HostConfig } from './host-config';
export { type Frontmatter, parseFrontmatter } from './markdown';
export { bootstrap, type BootstrapOptions, type BootstrapResult } from './bootstrap';

// ── paths ────────────────────────────────────────────────────────────
export { createXdgPaths, type XdgPaths } from './paths/xdg';

// ── approvals ────────────────────────────────────────────────────────
export {
  type ApprovalDecision,
  type ApprovalQueue,
  type ApprovalRequest,
  approvalQueueToPrompt,
  createApprovalQueue,
} from './approvals/queue';

// ── permissions ──────────────────────────────────────────────────────
export { compileGlob, matchArgs, matchTool } from './permissions/glob';
export { createPermissionRegistry, type PermissionRegistry } from './permissions/registry';
export {
  createPermissionHook,
  type PermissionHookOptions,
  type PermissionPrompt,
} from './permissions/hook';
export { loadPermissions } from './permissions/loader';
export type {
  PermissionCheck,
  PermissionConfig,
  PermissionDecision,
  PermissionResult,
  PermissionRule,
} from './permissions/types';

// ── skills ───────────────────────────────────────────────────────────
export { loadSkills } from './skills/loader';
export { parseSkill, type SkillParseInput } from './skills/parser';
export { formatSkillInvocation, formatSkillsForSystemPrompt } from './skills/system-prompt';
export type { Skill } from './skills/types';

// ── sub-agents ───────────────────────────────────────────────────────
export { loadSubAgents } from './sub-agents/loader';
export { parseSubAgent, type SubAgentParseInput } from './sub-agents/parser';
export { runSubAgent, type RunSubAgentOptions, type SubAgentRunResult } from './sub-agents/runner';
export {
  createSubAgentParallelTool,
  createSubAgentTool,
  formatSubAgentReplyForParent,
  type SubAgentToolDeps,
} from './sub-agents/tool';
export { filterToolsByPrimary, pickPrimaryAgent } from './sub-agents/primary';
export type { SubAgent } from './sub-agents/types';

// ── commands ─────────────────────────────────────────────────────────
export { type CommandRegistry, createCommandRegistry } from './commands/registry';
export type { Command, CommandResult, ParsedInput } from './commands/types';
export {
  type AgentsCommandDeps,
  createAgentsCommand,
  createHelpCommand,
  createModelCommand,
  createSessionsCommand,
  type HelpCommandDeps,
  type ModelCommandDeps,
  type SessionsCommandDeps,
} from './commands/defaults';

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
export type { Channel, ChannelContext, ChannelInEvent, ChannelOutEvent } from './channels/types';

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
