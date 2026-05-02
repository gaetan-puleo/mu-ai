import type { ActivityBus } from './activity';
import type { ChannelRegistry } from './channel';
import type { ProviderRegistry } from './provider/registry';
import type { SessionManager } from './session';
import type { ChatMessage, ProviderConfig, ToolCall, ToolDefinition } from './types/llm';

/** Source of agent definitions on disk; implemented by mu-agents. */
export interface AgentSourceRegistry {
  registerSource: (absoluteDirPath: string) => () => void;
}

import type { UIService } from './ui';

/**
 * MessageBus lets plugins inject synthetic messages into the live chat
 * transcript without participating in the LLM streaming loop.
 *
 *   - `append(msg)` pushes a message into the **on-screen** transcript right
 *     now. The host preserves it across subsequent agent `messages` events
 *     when the message looks plugin-synthetic (carries `customType`, `meta`,
 *     or `display.hidden`). The LLM does NOT see appended entries — it only
 *     sees what was sent in the most recent turn. Use for banners / status
 *     entries that should persist in the UI but not influence the model.
 *   - `injectNext(msg)` queues a message that's spliced in alongside the
 *     *next* user turn. The message reaches the LLM and is persisted with
 *     the rest of the transcript. Use for "system reminder" injections that
 *     should travel with the user's next message.
 *   - `subscribe(fn)` notifies on any transcript change. The listener fires
 *     once on subscribe with the current snapshot.
 */
export interface MessageBus {
  append: (message: ChatMessage) => void;
  injectNext: (message: ChatMessage) => void;
  drainNext: () => ChatMessage[];
  subscribe: (listener: (messages: ChatMessage[]) => void) => () => void;
  get: () => ChatMessage[];
}

/**
 * Renderer signature used by `registerMessageRenderer`. The host calls
 * `render(message)` whenever it encounters a message whose `customType`
 * matches the registered key. The return value is renderer-defined — for the
 * mu-coding host, it is a React element; renderer-agnostic hosts may use a
 * different shape.
 */
export type MessageRenderer = (message: ChatMessage) => unknown;

/**
 * Handler for plugin-registered keyboard shortcuts. Registering a handler
 * always consumes the key for that frame — the default editor binding is
 * skipped. Async handlers fire-and-forget; the input loop does not await.
 */
export type ShortcutHandler = () => void | Promise<void>;

export interface MentionCompletion {
  /** Value inserted into the input (replaces `@partial`). */
  value: string;
  /** Display label in the picker. Defaults to `value`. */
  label?: string;
  /** Secondary text shown dimly in the picker. */
  description?: string;
  /**
   * Optional grouping label rendered as a section header in the picker
   * (e.g. "agents", "files"). When unset, completions are rendered without
   * a group header. The host hides the header when only one group is shown.
   */
  category?: string;
}

export type MentionProvider = (partial: string) => MentionCompletion[] | Promise<MentionCompletion[]>;

/**
 * Side-channel registries the host exposes to plugins. None are guaranteed —
 * plugins should null-check before calling so they degrade gracefully on
 * non-TUI hosts (single-shot CLI, tests).
 */
export interface PluginExtras {
  /** Inject / observe synthetic chat messages. */
  messages?: MessageBus;
  /** Register a custom renderer for `ChatMessage.customType`. */
  registerMessageRenderer?: (customType: string, renderer: MessageRenderer) => () => void;
  /**
   * Claim a key combo. The id mirrors the input handler's internal key ids
   * (`tab`, `escape`, `ctrl+t`, ...). Returns an unregister fn.
   */
  registerShortcut?: (key: string, handler: ShortcutHandler) => () => void;
  /**
   * Provide @mention completions. Trigger char defaults to `@`. Returning an
   * empty array hides the picker for that prefix.
   */
  registerMentionProvider?: (trigger: string, provider: MentionProvider) => () => void;
}

/**
 * Read-only registry surface exposed to plugins via `PluginContext.registry`.
 * Lets a plugin enumerate tools or hand them off to a nested run (e.g. a
 * subagent loop) without circular type imports.
 */
export interface PluginRegistryView {
  getTools: () => PluginTool[];
  getFilteredTools: () => Promise<PluginTool[]>;
  getHooks: () => LifecycleHooks[];
  getSystemPrompts: () => Promise<string[]>;
  applySystemPromptTransforms: (prompt: string) => Promise<string>;
  /**
   * Provider registry handle (or `undefined` if the host didn't supply one).
   * Exposed so plugins that re-issue LLM calls (e.g. the mu-agents subagent
   * loop) can resolve the configured provider exactly like `runAgent` does.
   */
  getProviders: () => ProviderRegistry | undefined;
}

export interface PluginContext extends PluginExtras {
  cwd: string;
  config: Record<string, unknown>;
  /**
   * Host-provided UI service. Available when the host (e.g. mu-coding) supplies
   * one; otherwise plugins should fall back to a no-op or `ConsoleUIService`.
   */
  ui?: UIService;
  getPlugin?: <T extends Plugin>(name: string) => T | undefined;
  /**
   * Read-only handle to the live registry. Plugins use this for advanced
   * scenarios — e.g. running subagent loops via `runAgent` over a custom
   * tool subset. Most plugins should rely on hooks + their own `tools`
   * field instead.
   */
  registry?: PluginRegistryView;
  /**
   * Push status segments for this plugin into the registry. Replaces the older
   * polling-based `Plugin.statusLine()` getter. Pass `[]` to clear.
   */
  setStatusLine?: (segments: StatusSegment[]) => void;
  /**
   * Push info chips into the host's input footer (e.g. "Coding" agent
   * label). Replaces the segments previously pushed by *this* plugin. Pass
   * `[]` to clear. Hosts that don't render an input footer are free to
   * ignore the call.
   */
  setInputInfo?: (segments: InputInfoSegment[]) => void;
  /**
   * Host-provided graceful shutdown hook. When supplied, plugins should prefer
   * this over `process.exit(...)` so the host can deactivate plugins and restore
   * terminal state.
   */
  shutdown?: (code?: number) => Promise<void> | void;
  /** LLM provider registry. Plugins implementing providers register here. */
  providers?: ProviderRegistry;
  /** Channel registry — input surfaces (TUI, Telegram, websocket, ...). */
  channels?: ChannelRegistry;
  /** Session manager — owns conversation state per `sessionId`. */
  sessions?: SessionManager;
  /** Activity bus — pub/sub for agent + tool events (timeline, broadcast). */
  activity?: ActivityBus;
  /** Agent source registry (file-based agent definitions). */
  agents?: AgentSourceRegistry;
  /**
   * Plugins that *implement* an `AgentSourceRegistry` (i.e. mu-agents)
   * publish it here so subsequent plugins (mu-coding-agents, user packages)
   * see it in their own `ctx.agents`. The registry mutates the registry's
   * shared context so every following `register()` propagates the value.
   */
  setAgentsRegistry?: (registry: AgentSourceRegistry) => void;
}

/**
 * What a tool's `execute` may return:
 *  - a plain string (legacy / convenience): an error is heuristically inferred
 *    when the string starts with `"Error:"`. Convenient for quick tools but
 *    fragile (collisions with legitimate output that begins with that prefix).
 *  - a `ToolExecutorResult`: explicit `error` flag, no heuristics. Preferred
 *    for new tools and for any tool whose output may legitimately start with
 *    "Error:".
 *
 * The agent runtime accepts both forms; the registry doesn't care.
 */
export interface ToolExecutorResult {
  content: string;
  error?: boolean;
}

export type ToolExecutor = (
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<string | ToolExecutorResult> | string | ToolExecutorResult;

/**
 * Optional rendering hints the host can use when displaying a tool call.
 * The host (e.g. mu-coding's TUI) maps `kind` to a renderer; tools without a
 * `display` hint fall back to a generic preview.
 *
 * Kept renderer-agnostic on purpose — `mu-agents` has no React / Ink dependency.
 */
export interface ToolDisplayHint {
  /** Verb shown in the spinner line, e.g. "reading", "editing". */
  verb?: string;
  /** Renderer kind. Hosts decide how to render each kind. Built-ins use
   *  'file-read' | 'file-write' | 'diff' | 'shell'. */
  kind?: string;
  /** Semantic field mapping from rendering concepts to actual JSON arg names.
   *  Examples: { path: 'path' }, { from: 'from', to: 'to' }. */
  fields?: Record<string, string>;
}

/**
 * Permission descriptor. `matchKey` extracts the value to glob-match from
 * call args (e.g. `cmd` for bash, `path` for file tools). Tools without a
 * `matchKey` may only be configured with simple actions (`allow|deny|ask`).
 *
 * Validated at agent-definition load time by `mu-agents`.
 */
export interface PluginToolPermission {
  matchKey?: (args: Record<string, unknown>) => string | undefined;
}

export interface PluginTool {
  definition: ToolDefinition;
  execute: ToolExecutor;
  display?: ToolDisplayHint;
  permission?: PluginToolPermission;
}

export interface ToolResult {
  tool_call_id: string;
  name: string;
  content: string;
  error?: boolean;
}

export interface TurnResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage: number;
  /** Subset of prompt tokens served from the server's prompt cache, when
   *  reported. 0 when unsupported or no cache hit. */
  cachedPromptTokens?: number;
}

export type AgentEndReason = 'complete' | 'aborted';

/**
 * Result a `beforeToolExec` hook may return. Either:
 *   - a `ToolCall` (possibly mutated) — execution proceeds normally
 *   - a `ToolBlock` — the host short-circuits execution and uses the
 *     supplied content as the tool result (rendered as if the tool ran).
 *     Lets policy plugins reject calls without throwing.
 */
export interface ToolBlock {
  blocked: true;
  content: string;
  error?: boolean;
}

export type BeforeToolExecResult = ToolCall | ToolBlock;

/**
 * Result a `transformUserInput` hook may return.
 *   - `pass` (or `undefined`)  — leave the user's text untouched
 *   - `transform` — replace the text but still send it as a user message
 *   - `intercept` — suppress the input entirely; the host should not call the
 *     LLM. Plugins typically pair this with `MessageBus.append` to surface a
 *     reply or status entry.
 *   - `continue` — the hook has appended the user message itself (e.g. via
 *     `MessageBus.append` so it shows up live in the transcript). The host
 *     should NOT push another user message but should still run a turn:
 *     drain the injectNext queue and stream the LLM. Used by the subagent
 *     `@`-mention dispatch path so the user's message lands first, the
 *     subagent runs live, and the parent agent then takes a real turn.
 */
export type UserInputTransform =
  | { kind: 'pass' }
  | { kind: 'transform'; text: string }
  | { kind: 'intercept' }
  | { kind: 'continue' };

export interface LifecycleHooks {
  beforeLlmCall?: (messages: ChatMessage[], config: ProviderConfig) => ChatMessage[] | Promise<ChatMessage[]>;
  afterLlmCall?: (result: TurnResult) => TurnResult | Promise<TurnResult>;
  beforeToolExec?: (toolCall: ToolCall) => BeforeToolExecResult | Promise<BeforeToolExecResult>;
  afterToolExec?: (toolCall: ToolCall, result: string) => string | Promise<string>;
  /**
   * Restrict the tool set the LLM can see for the next turn. Plugins return
   * the subset of tools they want exposed. Multiple plugins compose by
   * intersection — each hook narrows the previous result.
   */
  filterTools?: (tools: PluginTool[]) => PluginTool[] | Promise<PluginTool[]>;
  /**
   * Mutate the merged system prompt right before it goes to the provider.
   * Composes left-to-right; later plugins see the prior plugin's output.
   * Useful for per-agent prompt wrapping.
   */
  transformSystemPrompt?: (prompt: string) => string | Promise<string>;
  /**
   * Inspect / transform / intercept user input on submit. Composes by
   * threading the current text through each plugin; an `intercept` short-
   * circuits and stops the chain. Hosts call this before constructing the
   * user `ChatMessage`.
   */
  transformUserInput?: (text: string) => UserInputTransform | Promise<UserInputTransform>;
  /**
   * Fires once per `runAgent` invocation, after the loop exits — whether the
   * agent finished normally (LLM produced a final response with no tool calls)
   * or was aborted via the signal. Plugins should use this for end-of-agent
   * cleanup; per-turn cleanup belongs in `afterLlmCall`.
   */
  afterAgentRun?: (reason: AgentEndReason) => void | Promise<void>;
  /**
   * Decorate a freshly built `ChatMessage` (user / assistant / tool) before
   * it's appended to the transcript. Plugins typically use this to stamp
   * `display.badge` / `display.color` (e.g. with the active agent name +
   * color) or augment `meta`. Hooks compose left-to-right; later hooks see
   * the prior hook's output. Should not change `role` or `content`.
   */
  decorateMessage?: (msg: ChatMessage) => ChatMessage | Promise<ChatMessage>;
}

export interface CommandContext {
  messages: ChatMessage[];
  cwd: string;
  config: ProviderConfig;
}

export interface SlashCommand {
  name: string;
  description: string;
  execute: (args: string, context: CommandContext) => Promise<string | undefined>;
}

export type AgentEvent =
  | { type: 'content'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'usage'; totalTokens: number; cachedTokens?: number }
  | { type: 'messages'; messages: ChatMessage[] }
  | { type: 'turn_end' };

export interface AgentLoopStrategy {
  name: string;
  run: (
    messages: ChatMessage[],
    config: ProviderConfig,
    model: string,
    signal: AbortSignal,
    tools: PluginTool[],
    hooks: LifecycleHooks[],
  ) => AsyncGenerator<AgentEvent>;
}

export interface StatusSegment {
  text: string;
  color?: string;
  dim?: boolean;
}

/**
 * Info chip a plugin pushes into the input footer (e.g. active agent name).
 * Aggregated across plugins by `PluginRegistry.getInputInfoSegments()` and
 * surfaced to the host's input UI in registration order.
 */
export interface InputInfoSegment {
  /** Stable key — used by the renderer for list reconciliation. */
  key: string;
  text: string;
  color?: string;
  bold?: boolean;
}

export interface Plugin {
  name: string;
  version?: string;

  tools?: PluginTool[];
  systemPrompt?: string | ((context: PluginContext) => string | Promise<string>);
  hooks?: LifecycleHooks;
  commands?: SlashCommand[];
  agentLoop?: AgentLoopStrategy;

  activate?: (context: PluginContext) => Promise<void> | void;
  deactivate?: () => Promise<void> | void;

  /**
   * Plugins may attach arbitrary public fields (e.g. an ApprovalGateway
   * instance, a SourceManager). Sibling plugins fetch them via
   * `ctx.getPlugin<MyPlugin>('name')` and dot into typed fields.
   */
  [extra: string]: unknown;
}
