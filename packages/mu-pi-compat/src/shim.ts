import { spawn } from 'node:child_process';
import type { PluginContext, PluginTool, SlashCommand, UIService } from 'mu-agents';
import type { ShutdownFn } from './loader';
import { translateCommand } from './translate-command';
import { translateTool } from './translate-tool';
import type {
  PiCommandOptions,
  PiEvent,
  PiEventEmitter,
  PiEventHandler,
  PiExtensionAPI,
  PiExtensionCommandContext,
  PiExtensionContext,
  PiFlagOptions,
  PiProviderConfig,
  PiSessionManager,
  PiShortcutOptions,
  PiToolDefinition,
  PiUI,
} from './types';

/**
 * PiShim implements the ExtensionAPI (`pi`) that Pi extensions receive.
 * It collects registrations and routes them into mu's Plugin interface.
 */
export class PiShim implements PiExtensionAPI {
  readonly tools: PluginTool[] = [];
  readonly commands: SlashCommand[] = [];
  readonly handlers: Map<string, Array<(...args: never[]) => unknown>> = new Map();

  private _sessionName: string | undefined;
  private _activeTools: Set<string> = new Set();
  private _thinkingLevel = 'normal';
  private _injectedMessages: unknown[] = [];
  private _systemPromptAdditions: string[] = [];
  private _ui: PiUI;

  constructor(
    private ctx: PluginContext,
    private uiService: UIService,
    private hostShutdown?: ShutdownFn,
  ) {
    this._ui = this.createUI();
  }

  // ─── Core Registration ──────────────────────────────────────────────────────

  on<E extends PiEvent>(event: E, handler: PiEventHandler<E>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as (...args: never[]) => unknown);
    this.handlers.set(event, list);
  }

  registerTool(def: PiToolDefinition): void {
    const ctx = this.makeContext();
    const tool = translateTool(def, ctx);
    this.tools.push(tool);
    this._activeTools.add(def.name);

    // Collect guidelines for system prompt
    if (def.guidelines) {
      this._systemPromptAdditions.push(def.guidelines);
    }
  }

  registerCommand(name: string, options: PiCommandOptions): void {
    const ctx = this.makeCommandContext();
    this.commands.push(translateCommand(name, options, ctx));
  }

  // ─── Stubs (not supported in mu, emit warnings) ─────────────────────────────

  registerShortcut(_shortcut: string, _options: PiShortcutOptions): void {
    // Keyboard shortcut registration not supported in mu
  }

  registerFlag(_name: string, _options: PiFlagOptions): void {
    // Custom flags not supported in mu
  }

  registerProvider(_name: string, _config: PiProviderConfig): void {
    // mu uses a single provider — custom providers not supported
  }

  registerMessageRenderer(_customType: string, _renderer: unknown): void {
    // Custom message rendering not supported in mu
  }

  // ─── Message Injection ──────────────────────────────────────────────────────

  sendMessage(message: unknown, _options?: unknown): void {
    this._injectedMessages.push(message);
  }

  sendUserMessage(content: string, _options?: unknown): void {
    this._injectedMessages.push({ role: 'user', content });
  }

  /**
   * Drain injected messages (called by the compat plugin in beforeLlmCall).
   */
  drainInjectedMessages(): unknown[] {
    const msgs = this._injectedMessages.slice();
    this._injectedMessages.length = 0;
    return msgs;
  }

  // ─── Session / State ────────────────────────────────────────────────────────

  appendEntry(_customType: string, _data?: unknown): void {
    // Session entries not supported in mu
  }

  setSessionName(name: string): void {
    this._sessionName = name;
  }

  getSessionName(): string | undefined {
    return this._sessionName;
  }

  setLabel(_entryId: string, _label: string): void {
    // No-op in mu
  }

  // ─── Tool Management ────────────────────────────────────────────────────────

  getCommands(): Array<{ name: string; description?: string }> {
    return this.commands.map((c) => ({ name: c.name, description: c.description }));
  }

  getActiveTools(): string[] {
    return Array.from(this._activeTools);
  }

  getAllTools(): string[] {
    return this.tools.map((t) => t.definition.function.name);
  }

  setActiveTools(names: string[]): void {
    this._activeTools = new Set(names);
  }

  isToolActive(name: string): boolean {
    return this._activeTools.has(name);
  }

  // ─── Model ──────────────────────────────────────────────────────────────────

  setModel(_model: unknown): void {
    // Model switching not directly supported via extensions in mu
  }

  getThinkingLevel(): string {
    return this._thinkingLevel;
  }

  setThinkingLevel(level: string): void {
    this._thinkingLevel = level;
  }

  // ─── Execution ──────────────────────────────────────────────────────────────

  exec(
    command: string,
    args: string[],
    _options?: unknown,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString('utf-8');
      });
      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString('utf-8');
      });
      proc.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });
      proc.on('error', (err) => {
        resolve({ stdout, stderr: err.message, exitCode: 1 });
      });
    });
  }

  // ─── Events Facade ──────────────────────────────────────────────────────────

  get events(): PiEventEmitter {
    type Handler = (...args: never[]) => unknown;
    return {
      on: (event: string, handler: Handler) => this.on(event as PiEvent, handler as PiEventHandler),
      off: (event: string, handler: Handler) => {
        const list = this.handlers.get(event);
        if (list) {
          const idx = list.indexOf(handler);
          if (idx >= 0) list.splice(idx, 1);
        }
      },
      emit: (_event: string, _data?: unknown) => {
        // Extensions shouldn't emit — this is for observation only
      },
    };
  }

  // ─── System Prompt ──────────────────────────────────────────────────────────

  get systemPromptAdditions(): string {
    return this._systemPromptAdditions.filter(Boolean).join('\n');
  }

  // ─── Event Dispatch ─────────────────────────────────────────────────────────

  /**
   * Fire all handlers registered for the given event.
   * Returns the first non-undefined result (for events that support return values).
   */
  async fireEvent<E extends PiEvent>(event: E, data: unknown): Promise<unknown> {
    const list = this.handlers.get(event);
    if (!list?.length) return undefined;

    const ctx = this.makeContext();
    let result: unknown;

    for (const handler of list) {
      const call = handler as (event: unknown, ctx: unknown) => unknown | Promise<unknown>;
      const r = await call(data, ctx);
      if (r !== undefined && result === undefined) {
        result = r;
      }
    }
    return result;
  }

  // ─── Context Factories ──────────────────────────────────────────────────────

  makeContext(signal?: AbortSignal): PiExtensionContext {
    const shutdown = this.hostShutdown;
    return {
      ui: this._ui,
      hasUI: true,
      cwd: this.ctx.cwd,
      sessionManager: this.makeSessionManager(),
      signal,
      isIdle: () => true,
      abort: () => {
        /* no-op: mu handles abort via AbortController */
      },
      hasPendingMessages: () => this._injectedMessages.length > 0,
      shutdown: () => {
        // Prefer the host's graceful shutdown so plugins are deactivated and
        // terminal escape sequences are restored. Fall back to process.exit
        // only when no host shutdown is configured (e.g. standalone usage).
        if (shutdown) {
          void shutdown(0);
        } else {
          process.exit(0);
        }
      },
      getContextUsage: () => null,
      compact: () => {
        /* no-op: mu has no compaction */
      },
      getSystemPrompt: () => '',
    };
  }

  private makeCommandContext(): PiExtensionCommandContext {
    return {
      ...this.makeContext(),
      waitForIdle: async () => {
        /* no-op: mu has no idle waiting */
      },
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      switchSession: async () => ({ cancelled: true }),
      reload: async () => {
        /* no-op: mu has no hot reload */
      },
    };
  }

  private makeSessionManager(): PiSessionManager {
    return {
      getEntries: () => [],
      getBranch: () => [],
      getLeafId: () => null,
      getSessionFile: () => null,
    };
  }

  private createUI(): PiUI {
    const svc = this.uiService;
    return {
      notify: (msg, level) => svc.notify(msg, level),
      confirm: (title, msg) => svc.confirm(title, msg),
      select: (title, opts) => svc.select(title, opts),
      input: (title, ph) => svc.input(title, ph),
      setStatus: (key, text) => svc.setStatus(key, text),
      clearStatus: (key) => svc.clearStatus(key),
      setWidget: (key, lines) => svc.setStatus(key, lines.join(' | ')),
      setTitle: () => {
        /* no-op: mu has no title control */
      },
      setEditorText: () => {
        /* no-op: mu has no editor text injection */
      },
      setFooter: () => {
        /* no-op: mu has no custom footer */
      },
      custom: async () => null,
    };
  }
}
