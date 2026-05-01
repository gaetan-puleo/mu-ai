import type { TSchema } from '@sinclair/typebox';
import type { UIService } from 'mu-agents';

// ─── Pi Extension API Types ────────────────────────────────────────────────────

/**
 * The factory function signature Pi extensions export as default.
 */
export type PiExtensionFactory = (pi: PiExtensionAPI) => void | Promise<void>;

/**
 * Pi tool content part.
 */
export interface PiToolContentPart {
  type: 'text' | 'image';
  text?: string;
  data?: string;
  mimeType?: string;
}

/**
 * Pi tool execution result.
 */
export interface PiToolResult {
  content: PiToolContentPart[];
  details?: Record<string, unknown>;
}

/**
 * Pi tool definition — what pi.registerTool() receives.
 */
export interface PiToolDefinition {
  name: string;
  label?: string;
  description: string;
  parameters?: TSchema | Record<string, unknown>;
  snippet?: string;
  guidelines?: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: (partial: string) => void,
    ctx: PiExtensionContext,
  ) => Promise<PiToolResult> | PiToolResult;
}

/**
 * Pi command handler options.
 */
export interface PiCommandOptions {
  description?: string;
  handler: (args: string, ctx: PiExtensionCommandContext) => Promise<void> | void;
  autocomplete?: (partial: string) => string[];
}

/**
 * Pi shortcut options (stubbed in mu).
 */
export interface PiShortcutOptions {
  description?: string;
  handler: () => Promise<void> | void;
}

/**
 * Pi flag options (stubbed in mu).
 */
export interface PiFlagOptions {
  description?: string;
  default?: boolean;
  onChange?: (value: boolean) => void;
}

/**
 * Pi provider model definition.
 */
export interface PiProviderModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  contextWindow?: number;
  maxTokens?: number;
}

/**
 * Pi provider config.
 */
export interface PiProviderConfig {
  baseUrl: string;
  apiKey?: string;
  api?: string;
  models: PiProviderModel[];
}

/**
 * Pi event types and their payloads.
 */
export interface PiEventMap {
  session_start: { reason: 'startup' | 'reload' | 'new' | 'resume' | 'fork'; previousSessionFile?: string };
  session_shutdown: { reason: 'quit' | 'reload' | 'new' | 'resume' | 'fork'; targetSessionFile?: string };
  session_before_switch: { reason: 'new' | 'resume'; targetSessionFile?: string };
  session_before_compact: {
    preparation: unknown;
    branchEntries: unknown;
    customInstructions?: string;
    signal?: AbortSignal;
  };
  session_compact: { compactionEntry: unknown; fromExtension: boolean };
  resources_discover: { cwd: string; reason: 'startup' | 'reload' };
  before_agent_start: { prompt: string; images?: unknown[]; systemPrompt: string; systemPromptOptions?: unknown };
  agent_start: Record<string, never>;
  agent_end: { messages: unknown[] };
  turn_start: { turnIndex: number; timestamp: number };
  turn_end: { turnIndex: number; message: unknown; toolResults?: unknown[] };
  message_start: { message: unknown };
  message_update: { message: unknown; assistantMessageEvent?: unknown };
  message_end: { message: unknown };
  tool_call: { toolName: string; toolCallId: string; input: Record<string, unknown> };
  tool_result: {
    toolName: string;
    toolCallId: string;
    input?: Record<string, unknown>;
    content: unknown;
    details?: unknown;
    isError?: boolean;
  };
  tool_execution_start: { toolCallId: string; toolName: string; args: Record<string, unknown> };
  tool_execution_update: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    partialResult?: string;
  };
  tool_execution_end: { toolCallId: string; toolName: string; result: unknown; isError: boolean };
  context: { messages: unknown[] };
  input: { text: string; images?: unknown[]; source: 'interactive' | 'rpc' | 'extension' };
  model_select: { model: unknown; previousModel?: unknown; source: string };
  thinking_level_select: { level: string; previousLevel?: string };
  before_provider_request: { payload: unknown };
  after_provider_response: { status: number; headers: Record<string, string> };
  user_bash: { command: string; excludeFromContext: boolean; cwd: string };
}

export type PiEvent = keyof PiEventMap;

export type PiEventHandler<E extends PiEvent = PiEvent> = (
  event: PiEventMap[E],
  ctx: PiExtensionContext,
) => unknown | Promise<unknown>;

/**
 * Pi session manager stub interface (read-only).
 */
export interface PiSessionManager {
  getEntries: () => unknown[];
  getBranch: () => unknown[];
  getLeafId: () => string | null;
  getSessionFile: () => string | null;
}

/**
 * Pi ExtensionContext — received by event handlers.
 */
export interface PiExtensionContext {
  ui: PiUI;
  hasUI: boolean;
  cwd: string;
  sessionManager: PiSessionManager;
  signal?: AbortSignal;
  isIdle: () => boolean;
  abort: () => void;
  hasPendingMessages: () => boolean;
  shutdown: () => void;
  getContextUsage: () => { tokens: number } | null;
  compact: (opts?: unknown) => void;
  getSystemPrompt: () => string;
}

/**
 * Pi ExtensionCommandContext — received by command handlers.
 * Extends ExtensionContext with session control methods (all stubbed in mu).
 */
export interface PiExtensionCommandContext extends PiExtensionContext {
  waitForIdle: () => Promise<void>;
  newSession: (opts?: unknown) => Promise<{ cancelled: boolean }>;
  fork: (entryId: string, opts?: unknown) => Promise<{ cancelled: boolean }>;
  switchSession: (path: string, opts?: unknown) => Promise<{ cancelled: boolean }>;
  reload: () => Promise<void>;
}

/**
 * Pi UI interface.
 */
export interface PiUI {
  notify: (message: string, level?: 'info' | 'success' | 'warning' | 'error') => void;
  confirm: (title: string, message: string) => Promise<boolean>;
  select: (title: string, options: string[]) => Promise<string | null>;
  input: (title: string, placeholder?: string) => Promise<string | null>;
  setStatus: (key: string, text: string) => void;
  clearStatus?: (key: string) => void;
  setWidget: (key: string, lines: string[]) => void;
  setTitle: (title: string) => void;
  setEditorText: (text: string) => void;
  setFooter: (segments: unknown[]) => void;
  custom: (opts: unknown) => Promise<unknown>;
}

/**
 * The ExtensionAPI object passed to Pi extension factory functions.
 */
export interface PiExtensionAPI {
  on: <E extends PiEvent>(event: E, handler: PiEventHandler<E>) => void;
  registerTool: (definition: PiToolDefinition) => void;
  registerCommand: (name: string, options: PiCommandOptions) => void;
  registerShortcut: (shortcut: string, options: PiShortcutOptions) => void;
  registerFlag: (name: string, options: PiFlagOptions) => void;
  registerProvider: (name: string, config: PiProviderConfig) => void;
  registerMessageRenderer: (customType: string, renderer: unknown) => void;
  sendMessage: (message: unknown, options?: unknown) => void;
  sendUserMessage: (content: string, options?: unknown) => void;
  appendEntry: (customType: string, data?: unknown) => void;
  setSessionName: (name: string) => void;
  getSessionName: () => string | undefined;
  setLabel: (entryId: string, label: string) => void;
  getCommands: () => Array<{ name: string; description?: string }>;
  getActiveTools: () => string[];
  getAllTools: () => string[];
  setActiveTools: (names: string[]) => void;
  setModel: (model: unknown) => void;
  getThinkingLevel: () => string;
  setThinkingLevel: (level: string) => void;
  exec: (
    command: string,
    args: string[],
    options?: unknown,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  events: PiEventEmitter;
}

/**
 * Minimal EventEmitter facade for pi.events.
 */
export interface PiEventEmitter {
  on: (event: string, handler: (...args: never[]) => unknown) => void;
  off: (event: string, handler: (...args: never[]) => unknown) => void;
  emit: (event: string, data?: unknown) => void;
}

/**
 * Configuration for the Pi compat plugin.
 */
export interface PiCompatConfig {
  /** Paths to Pi extension files or directories */
  extensions?: string[];
  /** UIService implementation (passed from mu-coding) */
  ui?: UIService;
  /**
   * Host-supplied graceful shutdown. When a Pi extension calls
   * `ctx.shutdown()`, the compat layer routes through this so the host can
   * deactivate plugins and restore terminal state. Falls back to
   * `process.exit(0)` only when no host shutdown is configured.
   */
  shutdown?: (code?: number) => Promise<void> | void;
}
