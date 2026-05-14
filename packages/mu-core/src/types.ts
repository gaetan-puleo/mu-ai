// mu-core: 8 primitives — loop, provider, session, channel, message, hooks, plugin, command.

import type { Session } from './session';

export type { Session };

export type Role = 'user' | 'assistant' | 'system' | 'tool';
export type Visibility = 'ui' | 'llm' | 'both';

export interface MessageMeta {
  source?: string;
  visibility?: Visibility;
  transient?: boolean;
}

export interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export interface ToolResult {
  content: string;
  error?: boolean;
}

export interface ToolResultInfo {
  name: string;
  content: string;
  error?: boolean;
}

export interface Message {
  id: string;
  ts: number;
  role: Role;
  content: string;
  reasoning?: string;
  channelId?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolResult?: ToolResultInfo;
  meta?: MessageMeta;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Extract the arg value used for permission glob-matching. Optional. */
  matchKey?: (args: Record<string, unknown>) => string | undefined;
  execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult> | ToolResult;
}

export interface ToolBlock {
  blocked: true;
  content: string;
  error?: boolean;
}

export interface ProviderConfig {
  baseUrl: string;
  /**
   * Optional. When unset, the active model must be selected at runtime
   * (e.g. via the TUI model picker fed by `GET /v1/models`). Provider
   * code that performs inference (`streamChat`) requires this to be
   * defined and will throw otherwise.
   */
  model?: string;
  systemPrompt?: string;
  /**
   * Required to actually run a turn. mu-core has no default provider —
   * hosts must select one that matches the `id` of a registered Provider
   * plugin (e.g. `'openai'`, `'local'`). When omitted, `session.run()`
   * yields a `turn_end` error.
   */
  providerId?: string;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens?: number;
}

export type StreamChunk =
  | { type: 'reasoning'; text: string }
  | { type: 'content'; text: string }
  | { type: 'tool_call'; toolCall: ToolCall };

export interface StreamOptions {
  signal?: AbortSignal;
  tools?: Tool[];
  onUsage?: (usage: Usage) => void;
}

export interface Provider {
  id: string;
  streamChat: (
    messages: Message[],
    config: ProviderConfig,
    options: StreamOptions,
  ) => AsyncIterable<StreamChunk>;
}

export interface TurnResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage?: Usage;
}

export type TurnReason = 'complete' | 'aborted' | 'error';

export interface Hooks {
  onSessionStart?: (session: Session) => void | Promise<void>;
  onSessionEnd?: (session: Session) => void | Promise<void>;
  onMessageAppend?: (
    message: Message,
    session: Session,
  ) => Message | null | undefined | Promise<Message | null | undefined>;
  beforeLlmCall?: (messages: Message[], session: Session) => Message[] | Promise<Message[]>;
  afterLlmCall?: (result: TurnResult, session: Session) => TurnResult | Promise<TurnResult>;
  beforeToolExec?: (
    call: ToolCall,
    session: Session,
  ) => ToolCall | ToolBlock | Promise<ToolCall | ToolBlock>;
  afterToolExec?: (call: ToolCall, result: ToolResult, session: Session) => ToolResult | Promise<ToolResult>;
  onTurnEnd?: (reason: TurnReason, session: Session) => void | Promise<void>;
}

export interface Command {
  name: string;
  description: string;
  execute: (args: string, session: Session) => void | Promise<void>;
}

export interface ChannelContext {
  session: (id?: string) => Session;
  getCommand: (name: string) => Command | undefined;
  listCommands: () => readonly Command[];
}

export interface Channel {
  readonly id: string;
  start: (ctx: ChannelContext) => Promise<void>;
  stop?: () => Promise<void>;
  send?: (message: Message, session: Session) => Promise<void> | void;
}

export type SessionEvent =
  | { type: 'session_started'; session: Session }
  | { type: 'session_ended'; session: Session }
  | { type: 'message_appended'; session: Session; message: Message }
  | { type: 'transcript_cleared'; session: Session }
  | { type: 'turn_started'; session: Session }
  | { type: 'turn_ended'; session: Session; reason: TurnReason };

export type TurnEvent =
  | { type: 'content'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'message'; message: Message }
  | { type: 'turn_end'; reason: TurnReason; error?: Error };

export interface RunInput {
  userMessage?: Message;
  config?: Partial<ProviderConfig>;
}

export type SystemPrompt = string | (() => string | Promise<string>);

export interface PluginAPI {
  readonly config: Record<string, unknown>;
  hook: (hooks: Hooks) => () => void;
  tool: (tool: Tool) => () => void;
  provider: (provider: Provider) => () => void;
  channel: (channel: Channel) => () => void;
  command: (command: Command) => () => void;
  systemPrompt: (prompt: SystemPrompt) => () => void;
  /** Create a fresh isolated session (used for sub-agents and similar nested contexts). */
  createSession: (opts?: SessionCreateOptions) => Session;
  getTool: (name: string) => Tool | undefined;
  getTools: () => Tool[];
  getProvider: (id: string) => Provider | undefined;
  getCommand: (name: string) => Command | undefined;
  listCommands: () => readonly Command[];
  getSession: (id: string) => Session | undefined;
  listSessions: () => readonly Session[];
  onSession: (fn: (session: Session) => void) => () => void;
}

export interface SessionCreateOptions {
  initialMessages?: Message[];
  /** Tag the session's origin (e.g. 'mu-agents-subagent') so listeners can filter. */
  meta?: { source?: string };
}

export interface Plugin {
  name: string;
  register: (api: PluginAPI) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}
