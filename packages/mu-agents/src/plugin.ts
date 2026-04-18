import type { ChatMessage, ProviderConfig, ToolCall, ToolDefinition } from 'mu-provider';

export interface PluginContext {
  cwd: string;
  config: Record<string, unknown>;
  getPlugin?: <T extends Plugin>(name: string) => T | undefined;
}

export type ToolExecutor = (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string> | string;

export interface PluginTool {
  definition: ToolDefinition;
  execute: ToolExecutor;
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

export interface LifecycleHooks {
  beforeLlmCall?: (messages: ChatMessage[], config: ProviderConfig) => ChatMessage[] | Promise<ChatMessage[]>;
  afterLlmCall?: (result: TurnResult) => TurnResult | Promise<TurnResult>;
  beforeToolExec?: (toolCall: ToolCall) => ToolCall | Promise<ToolCall>;
  afterToolExec?: (toolCall: ToolCall, result: string) => string | Promise<string>;
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
  statusLine?: () => StatusSegment[];

  activate?: (context: PluginContext) => Promise<void> | void;
  deactivate?: () => Promise<void> | void;
}
