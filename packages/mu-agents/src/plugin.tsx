import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentSourceRegistry,
  LifecycleHooks,
  Plugin,
  PluginContext,
  PluginRegistryView,
  PluginTool,
  ProviderConfig,
  SlashCommand,
} from 'mu-core';
import { type ApprovalGateway, createApprovalGateway } from './approval';
import { DEFAULT_PRIMARY_AGENTS, DEFAULT_SUB_AGENTS } from './builtin';
import { AgentManager } from './manager';
import { mergeAgents } from './markdown';
import { resolvePermission, type ToolMatchKeySpec, validatePermissionMap } from './permissions';
import { AGENT_MESSAGE_TYPES, AgentIndicatorMessage, AgentSwitchMessage, SubagentMessage } from './renderers';
import { type AgentSourceManager, createAgentSourceManager } from './sources';
import { createSubagentParallelTool, createSubagentTool } from './subagent';
import type { AgentDefinition } from './types';

export interface MuAgentPluginConfig {
  /** Override the user agents directory (defaults to `~/.config/mu/agents`). */
  agentsDir?: string;
  /** Override the settings path (defaults to `~/.local/share/mu/agent-state.json`). */
  settingsPath?: string;
  /** Provider config for subagent runs. Required if subagents are enabled. */
  config?: ProviderConfig;
  /** Model used when invoking subagents. Defaults to the host's current model. */
  model?: string;
  /**
   * Channel id used for `ask` permission prompts. Defaults to `'tui'`. The
   * host (mu-coding) registers an `ApprovalChannel` against this id to drive
   * the dialog UX.
   */
  approvalChannelId?: string;
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

/**
 * Build the per-agent system prompt the LLM sees. We prepend the agent body
 * with its allowed-tool whitelist so the model knows the contract; this is
 * additive on top of whatever the host already supplied.
 *
 * When subagent tools are part of the whitelist, also surface the available
 * subagent names so the model can resolve `@<name>` user mentions to a
 * concrete `subagent` / `subagent_parallel` call.
 */
function renderAgentPrompt(agent: AgentDefinition, subagents: AgentDefinition[]): string {
  const tools = agent.tools.length > 0 ? agent.tools.join(', ') : 'none';
  const lines = [
    `## Active agent: ${agent.name}`,
    '',
    agent.systemPrompt,
    '',
    `Available tools: ${tools}. Do not call other tools — the host enforces the whitelist.`,
  ];

  const hasSubagent =
    agent.tools.includes('subagent') || agent.tools.includes('subagent_parallel') || agent.tools.includes('*');
  if (hasSubagent && subagents.length > 0) {
    lines.push('');
    lines.push('### Subagents');
    lines.push('When the user writes `@<name>` they are requesting a subagent dispatch. Available subagents:');
    for (const sa of subagents) {
      lines.push(`- \`${sa.name}\` — ${sa.description}`);
    }
    lines.push('Use the `subagent` tool for one, `subagent_parallel` for several at once.');
  }
  return lines.join('\n');
}

/**
 * Append an agent-switch banner to the live transcript. Uses a plugin-private
 * `customType` so the host renders it via `AgentSwitchMessage`. The message
 * is hidden from the LLM (`role: 'assistant'` + `display.hidden`) — well, in
 * fact we keep `hidden` off so the LLM also sees the banner; this is fine
 * since the banner is short and gives the model context for the new mode.
 */
function appendSwitchBanner(ctx: PluginContext, previous: AgentDefinition | undefined, next: AgentDefinition): void {
  ctx.messages?.append({
    role: 'assistant',
    content: previous ? `Switched from \`${previous.name}\` to \`${next.name}\` mode.` : `Active agent: ${next.name}.`,
    customType: AGENT_MESSAGE_TYPES.switch,
    display: { color: next.color, badge: next.name },
    meta: { agent: next.name, previous: previous?.name },
  });
}

/**
 * Build the lifecycle hooks the plugin contributes:
 *  - `beforeLlmCall` snapshots the live model so subagents stay in sync
 *  - `transformSystemPrompt` injects the active agent's prompt
 *  - `filterTools` restricts the tool set the LLM can see
 *  - `beforeToolExec` policy-rejects tool calls that don't match the agent
 *    whitelist (so the agent prompt + tool registry stay in lock-step even
 *    if the LLM ignores the prompt and tries something it shouldn't)
 */
interface BuildHooksDeps {
  manager: AgentManager;
  modelRef: { current: string };
  approvalGateway: ApprovalGateway;
  approvalChannelId: string;
  registryRef: { current: PluginRegistryView | null };
}

function safeParseArgs(call: { function: { arguments: string } }): Record<string, unknown> {
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

function buildHooks(deps: BuildHooksDeps): LifecycleHooks {
  return {
    // Capture the live model on every LLM call so subagents launched mid-
    // session use whatever model the user is currently driving the host
    // with — not the one frozen at plugin construction time.
    beforeLlmCall: (messages, config) => {
      if (config.model) deps.modelRef.current = config.model;
      return messages;
    },
    transformSystemPrompt: (prompt) => {
      const agent = deps.manager.getActive();
      if (!agent) return prompt;
      const rendered = renderAgentPrompt(agent, deps.manager.getSubagents());
      return prompt ? `${prompt}\n\n${rendered}` : rendered;
    },
    filterTools: (tools) => {
      const agent = deps.manager.getActive();
      if (!agent || agent.tools.includes('*')) return tools;
      const allowed = new Set(agent.tools);
      return tools.filter((t) => allowed.has(t.definition.function.name));
    },
    beforeToolExec: async (call) => {
      const agent = deps.manager.getActive();
      if (!agent) return call;
      const toolName = call.function.name;
      const allowedByList = agent.tools.includes('*') || agent.tools.includes(toolName);

      // If the agent has a structured permission map, use it. Otherwise fall
      // back to the legacy whitelist-only check.
      if (agent.permissions) {
        const rule = agent.permissions[toolName];
        const args = safeParseArgs(call);
        const matchKey = findToolMatchKey(deps.registryRef.current, toolName);
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
        const result = await deps.approvalGateway.request({
          agentId: agent.name,
          toolName,
          toolArgs: args,
          channelId: deps.approvalChannelId,
        });
        if (result === 'approved') return call;
        return {
          blocked: true,
          error: true,
          content:
            result === 'timeout' ? `Tool '${toolName}' approval timed out.` : `Tool '${toolName}' denied by user.`,
        };
      }

      // Legacy path: whitelist gating only.
      if (allowedByList) return call;
      return {
        blocked: true,
        error: true,
        content: `Tool '${toolName}' is not allowed in agent '${agent.name}'. Allowed: ${agent.tools.join(', ') || 'none'}.`,
      };
    },
  };
}

interface BuildCommandsDeps {
  manager: AgentManager;
  ctxRef: { current: PluginContext | null };
}

function makeSwitchCommand(agent: AgentDefinition, deps: BuildCommandsDeps): SlashCommand {
  return {
    name: agent.name,
    description: `Switch to '${agent.name}' agent — ${agent.description}`,
    async execute(_args) {
      const previous = deps.manager.getActive();
      const switched = deps.manager.setActive(agent.name);
      if (switched && deps.ctxRef.current) {
        appendSwitchBanner(deps.ctxRef.current, previous, agent);
      }
      return undefined;
    },
  };
}

function buildCommands(deps: BuildCommandsDeps): SlashCommand[] {
  const list = deps.manager.getPrimary().map((a) => makeSwitchCommand(a, deps));
  list.push({
    name: 'agent',
    description: 'Show or switch active agent',
    async execute(args) {
      if (!args.trim()) {
        const active = deps.manager.getActive();
        const names = deps.manager
          .getPrimary()
          .map((a) => a.name)
          .join(', ');
        return `Current: ${active?.name ?? '(none)'}. Available: ${names}.`;
      }
      const previous = deps.manager.getActive();
      const switched = deps.manager.setActive(args.trim());
      if (!switched) return `Agent '${args.trim()}' not found.`;
      const next = deps.manager.getActive();
      if (next && deps.ctxRef.current) appendSwitchBanner(deps.ctxRef.current, previous, next);
      return undefined;
    },
  });
  return list;
}

interface ActivateDeps {
  manager: AgentManager;
  modelRef: { current: string };
  registryRef: { current: PluginRegistryView | null };
  ctxRef: { current: PluginContext | null };
  unregisterFns: Array<() => void>;
}

function registerRenderers(ctx: PluginContext, store: ActivateDeps['unregisterFns']): void {
  if (!ctx.registerMessageRenderer) return;
  // Wrap as JSX so the host's React reconciler sees real component instances
  // and any future hooks (theme / state) keep working.
  store.push(ctx.registerMessageRenderer(AGENT_MESSAGE_TYPES.switch, (m) => <AgentSwitchMessage msg={m} />));
  store.push(ctx.registerMessageRenderer(AGENT_MESSAGE_TYPES.indicator, (m) => <AgentIndicatorMessage msg={m} />));
  store.push(ctx.registerMessageRenderer(AGENT_MESSAGE_TYPES.subagent, (m) => <SubagentMessage msg={m} />));
}

function registerTabShortcut(ctx: PluginContext, deps: ActivateDeps): void {
  if (!ctx.registerShortcut) return;
  deps.unregisterFns.push(
    ctx.registerShortcut('tab', () => {
      const previous = deps.manager.getActive();
      const next = deps.manager.cycle();
      if (next) appendSwitchBanner(ctx, previous, next);
    }),
  );
}

function registerMentions(ctx: PluginContext, deps: ActivateDeps): void {
  if (!ctx.registerMentionProvider) return;
  deps.unregisterFns.push(
    ctx.registerMentionProvider('@', (partial) => {
      const lower = partial.toLowerCase();
      return deps.manager
        .getSubagents()
        .filter((a) => a.name.toLowerCase().startsWith(lower))
        .map((a) => ({ value: a.name, label: a.name, description: a.description }));
    }),
  );
}

function pushIndicator(ctx: PluginContext, manager: AgentManager): void {
  const agent = manager.getActive();
  if (!agent) return;
  ctx.setStatusLine?.([{ text: `▣ ${agent.name}`, color: agent.color }]);
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
  config?: ProviderConfig;
}

function buildInternals(pluginConfig: MuAgentPluginConfig): PluginInternals {
  const agentsDir = pluginConfig.agentsDir ?? defaultAgentsDir();
  const settingsPath = pluginConfig.settingsPath ?? defaultSettingsPath();
  const sources = createAgentSourceManager();
  // Register the user agents directory as the first source so it takes
  // precedence over later ones (mu-coding-agents, …).
  sources.registerSource(agentsDir);
  const overrides = sources.list();
  const agents = mergeAgents([...DEFAULT_PRIMARY_AGENTS, ...DEFAULT_SUB_AGENTS], overrides);
  const manager = new AgentManager({ ...agents, settingsPath });
  const approvalGateway = createApprovalGateway();
  return {
    agents,
    manager,
    sources,
    approvalGateway,
    approvalChannelId: pluginConfig.approvalChannelId ?? 'tui',
    modelRef: { current: pluginConfig.model ?? '' },
    registryRef: { current: null },
    ctxRef: { current: null },
    config: pluginConfig.config,
  };
}

/**
 * Plugin factory. Mu-coding loads this through the standard plugin loader,
 * which forwards `{ ui, shutdown, ...userConfig }`. The user-supplied config
 * keys we care about are spelled out in `MuAgentPluginConfig`.
 */
/**
 * Build a refresher that re-merges sources, validates each agent's
 * permission map against the live tool registry, and pushes the result into
 * the manager. Bound to a context so it can be invoked from chokidar
 * change events and on-demand `registerSource` calls alike.
 */
function buildAgentRefresher(ctx: PluginContext, internals: PluginInternals): (overrides: AgentDefinition[]) => void {
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
 * `setAgentsRegistry`, also attach to this plugin's own context for code
 * that re-reads `ctx.agents` after activation.
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
  };
  return [createSubagentTool(deps), createSubagentParallelTool(deps)];
}

function activatePlugin(ctx: PluginContext, internals: PluginInternals, unregisterFns: Array<() => void>): void {
  internals.ctxRef.current = ctx;
  internals.registryRef.current = ctx.registry ?? null;

  const refresh = buildAgentRefresher(ctx, internals);
  publishAgentRegistry(ctx, internals, refresh);
  unregisterFns.push(internals.sources.onChange(refresh));
  refresh(internals.sources.list());

  const activateDeps: ActivateDeps = {
    manager: internals.manager,
    modelRef: internals.modelRef,
    registryRef: internals.registryRef,
    ctxRef: internals.ctxRef,
    unregisterFns,
  };
  registerRenderers(ctx, unregisterFns);
  registerTabShortcut(ctx, activateDeps);
  registerMentions(ctx, activateDeps);
  pushIndicator(ctx, internals.manager);
  unregisterFns.push(internals.manager.onChange(() => pushIndicator(ctx, internals.manager)));
}

function deactivatePlugin(internals: PluginInternals, unregisterFns: Array<() => void>): void {
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
}

export function createMuAgentPlugin(rawConfig: MuAgentPluginConfig = {}): Plugin {
  const internals = buildInternals(rawConfig);
  const unregisterFns: Array<() => void> = [];

  return {
    name: 'mu-agent',
    version: '0.5.0',
    /** Public handle hosts can grab via `ctx.getPlugin('mu-agent')`. */
    approvalGateway: internals.approvalGateway,
    tools: buildSubagentTools(internals),
    hooks: buildHooks({
      manager: internals.manager,
      modelRef: internals.modelRef,
      approvalGateway: internals.approvalGateway,
      approvalChannelId: internals.approvalChannelId,
      registryRef: internals.registryRef,
    }),
    commands: buildCommands({ manager: internals.manager, ctxRef: internals.ctxRef }),
    activate(ctx) {
      activatePlugin(ctx, internals, unregisterFns);
    },
    deactivate() {
      deactivatePlugin(internals, unregisterFns);
    },
  };
}

/** Re-export for callers that need to inspect the message-type identifiers. */
export { AGENT_MESSAGE_TYPES };
