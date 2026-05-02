import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentSourceRegistry,
  type ChatMessage,
  type LifecycleHooks,
  type MessageBus,
  type Plugin,
  type PluginContext,
  type PluginRegistryView,
  type PluginTool,
  type ProviderConfig,
  runDecorateMessageHooks,
  type SlashCommand,
} from 'mu-core';
import { type ApprovalGateway, createApprovalGateway } from './approval';
import { DEFAULT_PRIMARY_AGENTS, DEFAULT_SUB_AGENTS } from './builtin';
import { AgentManager } from './manager';
import { mergeAgents } from './markdown';
import { enforceAgentPermissions } from './permissionGate';
import { type ToolMatchKeySpec, validatePermissionMap } from './permissions';
import { AGENT_MESSAGE_TYPES, SubagentMessage } from './renderers';
import { type AgentSourceManager, createAgentSourceManager } from './sources';
import { createSubagentParallelTool, createSubagentTool, runSubagent } from './subagent';
import { createSubagentRunRegistry, type SessionWriter, type SubagentRunRegistry } from './subagentRun';
import {
  type AgentSwitchTracker,
  buildAgentSwitchNote,
  createAgentSwitchTracker,
  recordSwitch,
  resetTracker,
} from './switchTracker';
import type { AgentDefinition } from './types';

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
   * Channel id used for `ask` permission prompts. Defaults to `'tui'`. The
   * host (mu-coding) registers an `ApprovalChannel` against this id to drive
   * the dialog UX.
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
    lines.push('Available subagents:');
    for (const sa of subagents) {
      lines.push(`- \`${sa.name}\` — ${sa.description}`);
    }
    lines.push('');
    // The host intercepts top-level `@<name>` user messages and forces a
    // dispatch *before* the LLM is called, so the agent never sees those
    // turns. The instructions below cover the remaining cases: the agent
    // proactively choosing to delegate mid-turn, or the user mentioning a
    // subagent inside a longer message that the host didn't intercept.
    lines.push(
      'You may proactively delegate work to a subagent by calling the `subagent` tool ' +
        '(or `subagent_parallel` for several at once). Compose a precise task description from ' +
        'the conversation context and pass it as `task=<description>`.',
    );
    lines.push(
      'While a subagent is running, do **not** redo the same delegated work yourself — the ' +
        "subagent owns that piece. Once it returns, the turn isn't over: relay its findings to " +
        "the user (attributing them by name) and then continue working on the user's original " +
        'task. Take the next concrete step — call another tool, dispatch another subagent, or ' +
        'make the required edit. Stop only when the original task is fully complete.',
    );
  }
  return lines.join('\n');
}

/**
 * Build the lifecycle hooks the plugin contributes:
 *  - `beforeLlmCall` snapshots the live model so subagents stay in sync
 *  - `transformSystemPrompt` injects the active agent's prompt
 *  - `filterTools` restricts the tool set the LLM can see
 *  - `beforeToolExec` policy-rejects tool calls that don't match the agent
 *    whitelist (so the agent prompt + tool registry stay in lock-step even
 *    if the LLM ignores the prompt and tries something it shouldn't)
 *  - `transformUserInput` injects a hidden system message describing the
 *    prior agent lineage so the new agent has context — only when the user
 *    has actually changed agents since their last send.
 */
interface BuildHooksDeps {
  manager: AgentManager;
  modelRef: { current: string };
  approvalGateway: ApprovalGateway;
  approvalChannelId: string;
  registryRef: { current: PluginRegistryView | null };
  tracker: AgentSwitchTracker;
  ctxRef: { current: PluginContext | null };
  /** Provider config + run registry — required for forced @-mention dispatch. */
  config?: ProviderConfig;
  runRegistry: SubagentRunRegistry;
  resolveSubagentSessionPath: (runId: string) => string | undefined;
}

/**
 * Match a leading `@<name>` and split the rest of the message into a task
 * description. The name component is the same `[\w-]+` shape the mention
 * picker emits, and the trailing text (when present) becomes the task
 * passed to the subagent verbatim.
 *
 * Returns `null` when the input doesn't start with `@<name>` so the
 * normal user-message flow takes over.
 */
function parseSubagentMention(text: string): { name: string; task: string } | null {
  const match = /^\s*@([\w-]+)(?:\s+([\s\S]+))?\s*$/.exec(text);
  if (!match) return null;
  return { name: match[1] ?? '', task: (match[2] ?? '').trim() };
}

function stampActiveAgent(msg: ChatMessage, manager: AgentManager): ChatMessage {
  // Stamp every freshly-built message with the active agent's name + color
  // so the TUI can show per-message attribution. Don't clobber display
  // fields a plugin (or the message author) already set, and skip messages
  // intentionally hidden from the UI.
  if (msg.display?.hidden) return msg;
  if (msg.role !== 'user') return msg;
  const agent = manager.getActive();
  if (!agent) return msg;
  const display = msg.display ?? {};
  const meta = msg.meta ?? {};
  return {
    ...msg,
    display: {
      ...display,
      badge: display.badge ?? agent.name,
      color: display.color ?? agent.color,
    },
    meta: { ...meta, agent: meta.agent ?? agent.name },
  };
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
    decorateMessage: (msg) => stampActiveAgent(msg, deps.manager),
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
      // Shared with the subagent shim — same permission semantics in both
      // paths so an `ask` rule looks identical to the user regardless of
      // who dispatched the tool call.
      return enforceAgentPermissions({
        agent,
        registry: deps.registryRef.current,
        approvalGateway: deps.approvalGateway,
        approvalChannelId: deps.approvalChannelId,
        call,
      });
    },
    transformUserInput: async (text) => {
      // FORCED subagent dispatch via `@<name>` mention. The LLM is too
      // unreliable to invoke `subagent` reliably from text alone, so we
      // pre-run the subagent here. `handleSubagentMention` live-appends
      // the user message and the `↳ subagent (running…)` header, then
      // queues the synthetic (assistant tool_call, tool result) pair for
      // the upcoming `runTurn` to drain. We return `'continue'` so the
      // host skips its own user-message push and just streams the LLM
      // follow-up over the augmented transcript.
      const handled = await handleSubagentMention(text, deps);

      const active = deps.manager.getActive();
      // Seed the tracker with the agent at first send so the very first
      // user message doesn't trigger a spurious inject.
      if (active && deps.tracker.current === null) deps.tracker.current = active.name;
      if (active) {
        const note = buildAgentSwitchNote(deps.tracker, active.name);
        if (note) {
          deps.ctxRef.current?.messages?.injectNext({
            role: 'system',
            content: note,
            display: { hidden: true },
            meta: { agent: active.name, source: 'mu-agents.switch' },
          });
        }
        // Reset the traversal so the next inject only fires if the user
        // switches agents again before the next send.
        resetTracker(deps.tracker, active.name);
      }

      return handled ? { kind: 'continue' } : { kind: 'pass' };
    },
  };
}

/**
 * Returns true when the given agent is allowed to dispatch subagents.
 * Mirrors the `filterTools` whitelist semantics: `*` opens everything,
 * otherwise the `subagent` tool name must be explicitly listed. Agents
 * that don't list it (e.g. read-only `plan`) cannot dispatch — neither
 * via tool calls (filtered out of the tool list) nor via `@`-mentions
 * (gated here).
 */
function agentCanDispatchSubagent(agent: AgentDefinition): boolean {
  if (agent.tools.includes('*')) return true;
  return agent.tools.includes('subagent');
}

/**
 * Run the subagent referenced by a `@<name>` mention and queue a synthetic
 * (assistant tool_call, tool result) pair for the next turn so the parent
 * LLM streams a real follow-up response over the augmented transcript.
 *
 * Returns `true` when the dispatch was performed (caller should still
 * fall through to the rest of `transformUserInput`); `false` when this
 * isn't our concern (no @-mention, unknown subagent, agent forbidden,
 * or required dependencies missing).
 *
 * Why pre-run instead of letting the LLM call `subagent` itself: small
 * models are flaky about tool dispatch from plain text and frequently
 * either skip the call entirely or duplicate the work. Pre-running keeps
 * the @-mention semantics deterministic.
 */
async function handleSubagentMention(text: string, deps: BuildHooksDeps): Promise<boolean> {
  const parsed = parseSubagentMention(text);
  if (!parsed) return false;
  const subagent = deps.manager.getSubagent(parsed.name);
  if (!subagent) return false;
  // Respect the active agent's tool whitelist: the @-mention is just a
  // shortcut for the `subagent` tool, so an agent that can't call the
  // tool can't dispatch via @ either. Without this gate, plan (read-only)
  // could dispatch any subagent by typing `@review` — an obvious
  // permission escape.
  const active = deps.manager.getActive();
  if (active && !agentCanDispatchSubagent(active)) return false;

  const ctx = deps.ctxRef.current;
  const registryView = deps.registryRef.current;
  if (!(deps.config && registryView)) return false;

  const messageBus = ctx?.messages;
  const task = parsed.task || `Use your default behaviour: ${subagent.description}`;

  // 1. Live-append the user's own message FIRST so it appears at the
  //    top of the dispatch block. We decorate it through the same hook
  //    chain `useChatSession.onSend` would have used, then return
  //    `'continue'` so the host skips its own user-message push.
  const userMsg = await runDecorateMessageHooks(registryView.getHooks(), {
    role: 'user' as const,
    content: text,
  });
  messageBus?.append(userMsg);

  // 2. Run the subagent live: `runSubagent` calls `emitHeader` with the
  //    default `headerVia: 'append'` so the `↳ subagent (running…)`
  //    header lands right after the user message and updates in place
  //    via the SubagentMessage renderer.
  // `runSubagent` returns the wrapped `content` (used by the LLM-driven
  // tool path), the unwrapped `raw` body (used here to build the relay
  // prompt), and the `runId` (so the relay prompt can correlate with the
  // SubagentRun in the registry).
  let result: { content: string; raw: string; runId: string; error: boolean };
  try {
    result = await runSubagent({
      agent: subagent,
      task,
      config: deps.config,
      model: deps.modelRef.current,
      registry: registryView,
      approvalGateway: deps.approvalGateway,
      approvalChannelId: deps.approvalChannelId,
      runRegistry: deps.runRegistry,
      messageBus: messageBus ?? null,
      resolveSessionPath: deps.resolveSubagentSessionPath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error('[mu-agents] @-mention dispatch failed:', err);
    // No run was created (the throw happened before `runSubagent`'s
    // registry.start call could run, or while wiring up). We still need
    // to ship a relay prompt so the parent agent surfaces the failure;
    // use empty `runId` since there's nothing to correlate to.
    const failure = `Subagent '${subagent.name}' failed: ${message}`;
    result = { content: failure, raw: failure, runId: '', error: true };
  }

  // 3. Queue a single hidden user message that carries the subagent's raw
  //    output + the relay/continue instruction. See `buildRelayPrompt`
  //    below for the rationale.
  messageBus?.injectNext(buildRelayPrompt(subagent.name, task, result.raw, result.runId));

  return true;
}

/**
 * Build the hidden relay-context message dropped onto the parent's next
 * turn. The previous design queued a synthetic (assistant tool_call, tool
 * result) pair, which produced a redundant `✓ subagent` UI block
 * alongside the canonical SubagentMessage block AND duplicated the body
 * in the LLM context (the SubagentMessage's `meta` plus the same body
 * inside the wrapped tool-result content).
 *
 * With `display.hidden: true` the message stays out of the on-screen
 * transcript but remains in the LLM payload; the parent agent sees the
 * body once during the relay turn and produces a real follow-up. Disk
 * and wire stay byte-aligned (no per-turn projection); on reload the
 * LLM sees the same view it had originally.
 */
function buildRelayPrompt(agentName: string, task: string, raw: string, runId: string): ChatMessage {
  return {
    role: 'user',
    content:
      '[Subagent dispatch context]\n' +
      `The "${agentName}" subagent returned the following for task ` +
      `"${task}":\n\n${raw}\n\n` +
      'Relay these findings to the user (attributing them to the ' +
      `${agentName} subagent), then continue with the user's original ` +
      'task. Take the next concrete step.',
    display: { hidden: true },
    meta: {
      source: 'mu-agents.mention-dispatch.relayContext',
      agent: agentName,
      subagentRunId: runId,
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
      deps.manager.setActive(agent.name);
      return undefined;
    },
  };
}

function buildCommands(deps: BuildCommandsDeps): SlashCommand[] {
  // One per-agent switch command (e.g. `/build`, `/plan`). The generic
  // `/agent` command was removed: discoverability comes from the per-agent
  // entries themselves and from the Tab shortcut + agent indicator.
  return deps.manager.getPrimary().map((a) => makeSwitchCommand(a, deps));
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
  store.push(ctx.registerMessageRenderer(AGENT_MESSAGE_TYPES.subagent, (m) => <SubagentMessage msg={m} />));
}

function registerTabShortcut(ctx: PluginContext, deps: ActivateDeps): void {
  if (!ctx.registerShortcut) return;
  deps.unregisterFns.push(
    ctx.registerShortcut('tab', () => {
      deps.manager.cycle();
    }),
  );
}

function registerMentions(ctx: PluginContext, deps: ActivateDeps): void {
  if (!ctx.registerMentionProvider) return;
  deps.unregisterFns.push(
    ctx.registerMentionProvider('@', (partial) => {
      // Don't suggest subagents the active agent can't actually dispatch
      // — otherwise the user gets autocomplete for a no-op (the @-mention
      // dispatch path itself is gated in `handleSubagentMention`).
      const active = deps.manager.getActive();
      if (active && !agentCanDispatchSubagent(active)) return [];
      const lower = partial.toLowerCase();
      return deps.manager
        .getSubagents()
        .filter((a) => a.name.toLowerCase().startsWith(lower))
        .map((a) => ({
          value: a.name,
          label: a.name,
          description: a.description,
          category: 'agents',
        }));
    }),
  );
}

function pushIndicator(ctx: PluginContext, manager: AgentManager): void {
  const agent = manager.getActive();
  if (!agent) {
    ctx.setInputInfo?.([]);
    return;
  }
  const display = agent.name.charAt(0).toUpperCase() + agent.name.slice(1);
  ctx.setInputInfo?.([{ key: 'mu-agents.active', text: display, color: agent.color, bold: true }]);
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
  // precedence over later ones (mu-coding-agents, …).
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
 * Layout:
 *   <parent-dir>/<parent-stem>.subagents/<runId>.jsonl
 *
 * Returns `undefined` when no parent path is configured — runs stay in
 * memory only and are dropped when the host exits.
 */
function deriveSubagentPath(parentPath: string | undefined, runId: string): string | undefined {
  if (!parentPath) return undefined;
  // Strip the trailing extension (`.jsonl`) once; bail out if the path
  // doesn't have a recognisable stem (defensive — getParentSessionPath
  // could in theory return something unexpected).
  const lastSlash = Math.max(parentPath.lastIndexOf('/'), parentPath.lastIndexOf('\\'));
  const dir = lastSlash >= 0 ? parentPath.slice(0, lastSlash) : '.';
  const file = lastSlash >= 0 ? parentPath.slice(lastSlash + 1) : parentPath;
  const stem = file.endsWith('.jsonl') ? file.slice(0, -'.jsonl'.length) : file;
  return join(dir, `${stem}.subagents`, `${runId}.jsonl`);
}

/**
 * Plugin factory. Mu-coding loads this through the standard plugin loader,
 * which forwards `{ ui, shutdown, ...userConfig }`. The user-supplied config
 * keys we care about are spelled out in `AgentsPluginConfig`.
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
    approvalGateway: internals.approvalGateway,
    approvalChannelId: internals.approvalChannelId,
    runRegistry: internals.runRegistry,
    messageBusRef: internals.messageBusRef,
    resolveSessionPath: (runId: string) => deriveSubagentPath(internals.getParentSessionPath?.(), runId),
  };
  return [createSubagentTool(deps), createSubagentParallelTool(deps)];
}

function activatePlugin(ctx: PluginContext, internals: PluginInternals, unregisterFns: Array<() => void>): void {
  internals.ctxRef.current = ctx;
  internals.registryRef.current = ctx.registry ?? null;
  internals.messageBusRef.current = ctx.messages ?? null;

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
  unregisterFns.push(
    internals.manager.onChange((next) => {
      pushIndicator(ctx, internals.manager);
      if (next) recordSwitch(internals.tracker, next.name);
    }),
  );
  // Reset traversal state when the session is wiped (e.g. /new). The host
  // emits an empty `messages` snapshot through the message bus on session
  // reset; we hook that to forget any pending traversal so the next first
  // user turn doesn't ship a stale switch note.
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
  internals.messageBusRef.current = null;
}

export function createAgentsPlugin(rawConfig: AgentsPluginConfig = {}): Plugin {
  const internals = buildInternals(rawConfig);
  const unregisterFns: Array<() => void> = [];

  return {
    name: 'mu-agents',
    version: '0.5.0',
    /** Public handle hosts can grab via `ctx.getPlugin('mu-agents')`. */
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
      resolveSubagentSessionPath: (runId) => deriveSubagentPath(internals.getParentSessionPath?.(), runId),
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
