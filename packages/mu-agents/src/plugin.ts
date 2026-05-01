import type { ChatMessage, ProviderConfig, ToolCall, ToolDefinition } from 'mu-provider';
import type { UIService } from './ui';

export interface PluginContext {
  cwd: string;
  config: Record<string, unknown>;
  /**
   * Host-provided UI service. Available when the host (e.g. mu-coding) supplies
   * one; otherwise plugins should fall back to a no-op or `ConsoleUIService`.
   */
  ui?: UIService;
  getPlugin?: <T extends Plugin>(name: string) => T | undefined;
  /**
   * Push status segments for this plugin into the registry. Replaces the older
   * polling-based `Plugin.statusLine()` getter. Pass `[]` to clear.
   */
  setStatusLine?: (segments: StatusSegment[]) => void;
  /**
   * Host-provided graceful shutdown hook. When supplied, plugins should prefer
   * this over `process.exit(...)` so the host can deactivate plugins and restore
   * terminal state.
   */
  shutdown?: (code?: number) => Promise<void> | void;
}

export type ToolExecutor = (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string> | string;

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
   *  Examples: { path: 'path' }, { from: 'old_string', to: 'new_string' }. */
  fields?: Record<string, string>;
}

export interface PluginTool {
  definition: ToolDefinition;
  execute: ToolExecutor;
  display?: ToolDisplayHint;
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
}

export type AgentEndReason = 'complete' | 'aborted';

export interface LifecycleHooks {
  beforeLlmCall?: (messages: ChatMessage[], config: ProviderConfig) => ChatMessage[] | Promise<ChatMessage[]>;
  afterLlmCall?: (result: TurnResult) => TurnResult | Promise<TurnResult>;
  beforeToolExec?: (toolCall: ToolCall) => ToolCall | Promise<ToolCall>;
  afterToolExec?: (toolCall: ToolCall, result: string) => string | Promise<string>;
  /**
   * Fires once per `runAgent` invocation, after the loop exits — whether the
   * agent finished normally (LLM produced a final response with no tool calls)
   * or was aborted via the signal. Plugins should use this for end-of-agent
   * cleanup; per-turn cleanup belongs in `afterLlmCall`.
   */
  afterAgentRun?: (reason: AgentEndReason) => void | Promise<void>;
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
  | { type: 'usage'; totalTokens: number }
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
}
