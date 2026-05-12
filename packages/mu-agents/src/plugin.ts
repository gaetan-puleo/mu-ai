/**
 * mu-agents plugin factory.
 *
 * Owns plugin lifecycle (activate / deactivate) and wires together the
 * subsystems split into focused modules:
 *
 *  - `hooks/agentHooks.ts`     — beforeLlmCall / decorate / transform / filter
 *  - `dispatch/mention.ts`     — `@<subagent>` dispatch
 *  - `ui/activateUI.ts`        — tab shortcut, mention provider, input indicator
 *  - `subagentTools.ts` (via `./subagent`) — `subagent` / `subagent_parallel`
 *  - `subAgentBus.ts`          — sub-agent event pub/sub (moved from mu-core)
 *  - `subagentRun.ts`          — run registry + snapshot derivation
 *  - `approval.ts`             — approval gateway + snapshot derivation
 *
 * No JSX here — the Ink renderer for `mu-agents.subagent` messages
 * lives in mu-coding (`tui/components/messages/SubagentMessage.tsx`)
 * so mu-agents stays renderer-agnostic.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentSourceRegistry,
  MessageBus,
  Plugin,
  PluginContext,
  PluginRegistryView,
  PluginTool,
  ProviderConfig,
} from 'mu-core';
import { type ApprovalGateway, createApprovalGateway } from './approval';
import { DEFAULT_PRIMARY_AGENTS, DEFAULT_SUB_AGENTS } from './builtin';
import { buildHooks } from './hooks/agentHooks';
import { AgentManager } from './manager';
import { mergeAgents } from './markdown';
import { type ToolMatchKeySpec, validatePermissionMap } from './permissions';
import { type AgentSourceManager, createAgentSourceManager } from './sources';
import { createSubagentParallelTool, createSubagentTool } from './subagent';
import {
  createSubagentRunRegistry,
  type SessionWriter,
  type SubagentRunRegistry,
} from './subagentRun';
import {
  type AgentSwitchTracker,
  createAgentSwitchTracker,
  recordSwitch,
  resetTracker,
} from './switchTracker';
import type { AgentDefinition } from './types';
import {
  type ActivateUIDeps,
  pushIndicator,
  registerMentions,
  registerTabShortcut,
} from './ui/activateUI';

export interface AgentsPluginConfig {
  /** Override the user agents directory (defaults to `~/.config/mu/agents`). */
  agentsDir?: string;
  /** Override the settings path (defaults to `~/.local/share/mu/agent-state.json`). */
  settingsPath?: string;
  /** Provider config for subagent runs. Required if subagents are enabled. */
  config?: ProviderConfig;
  /** Model used when invoking subagents. Defaults to the host's current model. */
  model?: string;
  /**
   * Channel id used for `ask` permission prompts. Defaults to `'tui'`.
   */
  approvalChannelId?: string;
  /**
   * Returns the absolute path of the parent session JSONL. Used to derive
   * a sibling directory for persisted subagent runs. When undefined, runs
   * stay in memory only.
   */
  getParentSessionPath?: () => string | undefined;
  /**
   * Persist a subagent transcript. Provided by the host so mu-agents
   * doesn't have to import mu-coding's `saveSession`. When undefined,
   * subagent runs are not written to disk.
   */
  sessionWriter?: SessionWriter;
}

const HOME = homedir();

function defaultAgentsDir(): string {
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'mu', 'agents')
    : join(HOME, '.config', 'mu', 'agents');
}

function defaultSettingsPath(): string {
  return process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, 'mu', 'agent-state.json')
    : join(HOME, '.local', 'share', 'mu', 'agent-state.json');
}

interface PluginInternals {
  agents: { primary: AgentDefinition[]; subagent: AgentDefinition[] };
  manager: AgentManager;
  sources: AgentSourceManager;
  approvalGateway: ApprovalGateway;
  approvalChannelId: string;
  modelRef: { current: string };
  registryRef: { current: PluginRegistryView | null };
  ctxRef: { current: PluginContext | null };
  messageBusRef: { current: MessageBus | null };
  tracker: AgentSwitchTracker;
  runRegistry: SubagentRunRegistry;
  getParentSessionPath?: () => string | undefined;
  config?: ProviderConfig;
}

function buildInternals(pluginConfig: AgentsPluginConfig): PluginInternals {
  const agentsDir = pluginConfig.agentsDir ?? defaultAgentsDir();
  const settingsPath = pluginConfig.settingsPath ?? defaultSettingsPath();
  const sources = createAgentSourceManager();
  // Register the user agents directory as the first source so it takes
  // precedence over later ones.
  sources.registerSource(agentsDir);
  const overrides = sources.list();
  const agents = mergeAgents([...DEFAULT_PRIMARY_AGENTS, ...DEFAULT_SUB_AGENTS], overrides);
  const manager = new AgentManager({ ...agents, settingsPath });
  const approvalGateway = createApprovalGateway();
  const runRegistry = createSubagentRunRegistry();
  if (pluginConfig.sessionWriter) runRegistry.setSessionWriter(pluginConfig.sessionWriter);
  return {
    agents,
    manager,
    sources,
    approvalGateway,
    approvalChannelId: pluginConfig.approvalChannelId ?? 'tui',
    modelRef: { current: pluginConfig.model ?? '' },
    registryRef: { current: null },
    ctxRef: { current: null },
    messageBusRef: { current: null },
    tracker: createAgentSwitchTracker(),
    runRegistry,
    getParentSessionPath: pluginConfig.getParentSessionPath,
    config: pluginConfig.config,
  };
}

/**
 * Derive the persistence path for a single subagent run.
 *
 * Layout: `<parent-dir>/<parent-stem>.subagents/<runId>.jsonl`.
 * Returns `undefined` when no parent path is configured — runs stay in
 * memory only and are dropped when the host exits.
 */
function deriveSubagentPath(parentPath: string | undefined, runId: string): string | undefined {
  if (!parentPath) return undefined;
  const lastSlash = Math.max(parentPath.lastIndexOf('/'), parentPath.lastIndexOf('\\'));
  const dir = lastSlash >= 0 ? parentPath.slice(0, lastSlash) : '.';
  const file = lastSlash >= 0 ? parentPath.slice(lastSlash + 1) : parentPath;
  const stem = file.endsWith('.jsonl') ? file.slice(0, -'.jsonl'.length) : file;
  return join(dir, `${stem}.subagents`, `${runId}.jsonl`);
}

/**
 * Build a refresher that re-merges sources, validates each agent's
 * permission map against the live tool registry, and pushes the result
 * into the manager. Bound to a context so it can be invoked from
 * chokidar change events and on-demand `registerSource` calls alike.
 */
function buildAgentRefresher(
  ctx: PluginContext,
  internals: PluginInternals,
): (overrides: AgentDefinition[]) => void {
  return (overrides: AgentDefinition[]) => {
    const merged = mergeAgents([...DEFAULT_PRIMARY_AGENTS, ...DEFAULT_SUB_AGENTS], overrides);
    const knownTools: ToolMatchKeySpec[] = (ctx.registry?.getTools() ?? []).map((t) => ({
      toolName: t.definition.function.name,
      matchKey: t.permission?.matchKey,
    }));
    for (const agent of [...merged.primary, ...merged.subagent]) {
      if (!agent.permissions) continue;
      try {
        validatePermissionMap(agent.permissions, knownTools);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui?.notify(`Agent "${agent.name}": ${message}`, 'warning');
      }
    }
    internals.manager.setAgents(merged.primary, merged.subagent);
  };
}

/**
 * Wire the AgentSourceRegistry: publish to subsequent plugins via
 * `setAgentsRegistry`, also attach to this plugin's own context for
 * code that re-reads `ctx.agents` after activation.
 */
function publishAgentRegistry(
  ctx: PluginContext,
  internals: PluginInternals,
  refresh: (overrides: AgentDefinition[]) => void,
): void {
  const agentRegistry: AgentSourceRegistry = {
    registerSource: (dir) => {
      const off = internals.sources.registerSource(dir);
      refresh(internals.sources.list());
      return off;
    },
  };
  ctx.setAgentsRegistry?.(agentRegistry);
  ctx.agents = agentRegistry;
}

function buildSubagentTools(internals: PluginInternals): PluginTool[] {
  if (!internals.config) return [];
  const deps = {
    manager: internals.manager,
    config: internals.config,
    modelRef: internals.modelRef,
    registryRef: internals.registryRef,
    approvalGateway: internals.approvalGateway,
    approvalChannelId: internals.approvalChannelId,
    runRegistry: internals.runRegistry,
    messageBusRef: internals.messageBusRef,
    resolveSessionPath: (runId: string) =>
      deriveSubagentPath(internals.getParentSessionPath?.(), runId),
  };
  return [createSubagentTool(deps), createSubagentParallelTool(deps)];
}

function activatePlugin(
  ctx: PluginContext,
  internals: PluginInternals,
  unregisterFns: Array<() => void>,
): void {
  internals.ctxRef.current = ctx;
  internals.registryRef.current = ctx.registry ?? null;
  internals.messageBusRef.current = ctx.messages ?? null;

  const refresh = buildAgentRefresher(ctx, internals);
  publishAgentRegistry(ctx, internals, refresh);
  unregisterFns.push(internals.sources.onChange(refresh));
  refresh(internals.sources.list());

  const uiDeps: ActivateUIDeps = {
    manager: internals.manager,
    unregisterFns,
  };
  registerTabShortcut(ctx, uiDeps);
  registerMentions(ctx, uiDeps);
  pushIndicator(ctx, internals.manager);

  unregisterFns.push(
    internals.manager.onChange((next) => {
      pushIndicator(ctx, internals.manager);
      if (next) recordSwitch(internals.tracker, next.name);
    }),
  );

  // Reset traversal state when the session is wiped (e.g. /new). The
  // host emits an empty `messages` snapshot through the message bus on
  // session reset; we hook that to forget any pending traversal so the
  // next first user turn doesn't ship a stale switch note.
  if (ctx.messages?.subscribe) {
    let lastLen = ctx.messages.get?.().length ?? 0;
    unregisterFns.push(
      ctx.messages.subscribe((messages) => {
        if (messages.length === 0 && lastLen > 0) {
          resetTracker(internals.tracker, internals.manager.getActive()?.name ?? null);
        }
        lastLen = messages.length;
      }),
    );
  }
}

function deactivatePlugin(
  internals: PluginInternals,
  unregisterFns: Array<() => void>,
): void {
  while (unregisterFns.length) {
    const fn = unregisterFns.pop();
    try {
      fn?.();
    } catch {
      /* swallow per-handler errors so the rest still run */
    }
  }
  void internals.sources.dispose();
  internals.ctxRef.current = null;
  internals.messageBusRef.current = null;
}

/**
 * Plugin factory. Hosts load this through their plugin loader (or
 * directly).  The user-supplied config keys are spelled out in
 * `AgentsPluginConfig`.
 */
export function createAgentsPlugin(rawConfig: AgentsPluginConfig = {}): Plugin {
  const internals = buildInternals(rawConfig);
  const unregisterFns: Array<() => void> = [];

  return {
    name: 'mu-agents',
    version: '0.6.0',
    /** Public handle hosts grab via `ctx.getPlugin('mu-agents')`. */
    approvalGateway: internals.approvalGateway,
    /** Public handle to the agent manager (active agent + onChange). */
    manager: internals.manager,
    /** Live + historical subagent runs, observable from the host UI. */
    runs: internals.runRegistry,
    tools: buildSubagentTools(internals),
    hooks: buildHooks({
      manager: internals.manager,
      modelRef: internals.modelRef,
      approvalGateway: internals.approvalGateway,
      approvalChannelId: internals.approvalChannelId,
      registryRef: internals.registryRef,
      tracker: internals.tracker,
      ctxRef: internals.ctxRef,
      config: internals.config,
      runRegistry: internals.runRegistry,
      resolveSubagentSessionPath: (runId) =>
        deriveSubagentPath(internals.getParentSessionPath?.(), runId),
    }),
    // mu-agents intentionally does NOT contribute slash commands —
    // hosts that want `/agent` etc. build their own plugin reading
    // `getPlugin('mu-agents').manager`.
    activate(ctx) {
      activatePlugin(ctx, internals, unregisterFns);
    },
    deactivate() {
      deactivatePlugin(internals, unregisterFns);
    },
  };
}
