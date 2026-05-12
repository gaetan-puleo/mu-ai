/**
 * `MuRuntime` — canonical runtime object and `startMu` factory.
 *
 * Every host (mu-coding TUI, arya WS server, future Telegram bot, tests)
 * calls `startMu(options)` to obtain a `MuRuntime`. The runtime owns all
 * registries, the session manager, the message bus, and exposes the
 * single canonical entry points:
 *
 *   - `runtime.submitText()`    — user text → run a turn
 *   - `runtime.submitCommand()` — slash command dispatch
 *   - `runtime.start()`         — start channels
 *   - `runtime.shutdown()`      — stop everything
 *
 * No host should manually run hooks, build user messages, drain inject
 * queues, or call `runAgent` directly.
 */

import type { ActivityBus } from '../activity';
import { createActivityBus } from '../activity';
import type { ChannelRegistry } from '../channel';
import { createChannelRegistry } from '../channel';
import type { MessageBusRouter } from '../messageBus/sessionScoped';
import { createSessionScopedMessageBus } from '../messageBus/sessionScoped';
import type { MessageBus, Plugin, SlashCommand } from '../plugin';
import type { ProviderRegistry } from '../provider/registry';
import { createProviderRegistry } from '../provider/registry';
import { PluginRegistry } from '../registry';
import type { SessionManager } from '../session';
import { createSessionManager } from '../session';
import { attachAutoPersist } from '../sessionStore/autoPersist';
import type { SessionStore } from '../sessionStore/types';
import type { ChatMessage, ProviderConfig } from '../types/llm';
import { type RunHostTurnOutcome, runHostTurn } from './runHostTurn';

// ─── Public types ───────────────────────────────────────────────────────────

export interface MuConfigShape {
  cwd?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  streamTimeoutMs?: number;
  systemPrompt?: string;
  plugins?: Array<string | { name: string; config?: Record<string, unknown> }>;
}

export interface SubmitTextInput {
  sessionId: string;
  text: string;
  channelId?: string;
  userId?: string;
  userName?: string;
  config?: ProviderConfig;
  model?: string;
  decorateUserMessage?: (msg: ChatMessage) => ChatMessage | Promise<ChatMessage>;
}

export type SubmitTextResult = RunHostTurnOutcome;

export interface SubmitCommandInput {
  sessionId: string;
  commandName: string;
  args: string;
}

export type SubmitCommandResult = { kind: 'executed'; output?: string } | { kind: 'not_found' };

export interface MuRuntime {
  registry: PluginRegistry;
  sessions: SessionManager;
  channels: ChannelRegistry;
  providers: ProviderRegistry;
  messageBus: MessageBusRouter;
  activity: ActivityBus;
  store?: SessionStore;
  config: ProviderConfig;

  submitText: (input: SubmitTextInput) => Promise<SubmitTextResult>;
  submitCommand: (input: SubmitCommandInput) => Promise<SubmitCommandResult>;
  start: () => Promise<void>;
  shutdown: () => Promise<void>;
}

// ─── StartMu options ────────────────────────────────────────────────────────

export interface StartMuOptions {
  configPath?: string;
  config?: MuConfigShape;
  plugins?: Plugin[];
  cwd?: string;
  store?: SessionStore;
  messages?: MessageBus | MessageBusRouter;
  resolvePlugin?: (entry: string | { name: string; config?: Record<string, unknown> }) => Promise<Plugin | null>;
}

// ─── Internals ──────────────────────────────────────────────────────────────

async function loadConfig(opts: StartMuOptions): Promise<MuConfigShape> {
  if (opts.config) return opts.config;
  if (!opts.configPath) return {};
  const { readFileSync, existsSync } = await import('node:fs');
  if (!existsSync(opts.configPath)) return {};
  const text = readFileSync(opts.configPath, 'utf8');
  return JSON.parse(text) as MuConfigShape;
}

function isRouter(bus: MessageBus | MessageBusRouter | undefined): bus is MessageBusRouter {
  return !!bus && typeof (bus as MessageBusRouter).setCurrentSession === 'function';
}

// ─── Factory ────────────────────────────────────────────────────────────────

function buildProviderConfig(cfg: MuConfigShape): ProviderConfig {
  return {
    baseUrl: cfg.baseUrl ?? 'http://localhost:11434/v1',
    model: cfg.model,
    maxTokens: cfg.maxTokens ?? 4096,
    temperature: cfg.temperature ?? 0.7,
    streamTimeoutMs: cfg.streamTimeoutMs ?? 60_000,
    systemPrompt: cfg.systemPrompt,
  };
}

function buildRuntime(
  registry: PluginRegistry,
  sm: SessionManager,
  channels: ChannelRegistry,
  providers: ProviderRegistry,
  messageBus: MessageBusRouter,
  activity: ActivityBus,
  providerConfig: ProviderConfig,
  store: SessionStore | undefined,
  cwd: string,
): MuRuntime {
  return {
    registry,
    sessions: sm,
    channels,
    providers,
    messageBus,
    activity,
    store,
    config: providerConfig,
    async submitText(input) {
      const session = sm.getOrCreate(input.sessionId);
      return runHostTurn({
        session,
        registry,
        messageBus,
        userText: input.text,
        config: input.config ?? providerConfig,
        model: input.model,
        decorateUserMessage: input.decorateUserMessage,
      });
    },
    async submitCommand(input) {
      const commands: SlashCommand[] = registry.getCommands();
      const cmd = commands.find((c) => c.name === input.commandName);
      if (!cmd) return { kind: 'not_found' };
      const session = sm.getOrCreate(input.sessionId);
      const output = await cmd.execute(input.args, {
        messages: session.getMessages(),
        cwd,
        config: providerConfig,
      });
      return { kind: 'executed', output: output ?? undefined };
    },
    async start() {
      await channels.startAll();
    },
    async shutdown() {
      await channels.stopAll();
      for (const s of sm.list()) s.abort();
      await registry.shutdown();
    },
  };
}

export async function startMu(options: StartMuOptions = {}): Promise<MuRuntime> {
  const cfg = await loadConfig(options);
  const cwd = options.cwd ?? cfg.cwd ?? process.cwd();

  const providers = createProviderRegistry();
  const channels = createChannelRegistry();
  const activity = createActivityBus();
  const messageBus: MessageBusRouter = isRouter(options.messages) ? options.messages : createSessionScopedMessageBus();
  const providerConfig = buildProviderConfig(cfg);

  let sessions: SessionManager | null = null;
  const sessionsProxy: SessionManager = new Proxy({} as SessionManager, {
    get(_t, prop) {
      if (!sessions) throw new Error('SessionManager not yet initialised');
      return (sessions as unknown as Record<string | symbol, unknown>)[prop as string];
    },
  });

  const registry = new PluginRegistry({
    cwd,
    config: {},
    providers,
    channels,
    activity,
    sessions: sessionsProxy,
    messages: options.messages ?? messageBus,
  });

  sessions = createSessionManager({ registry, config: providerConfig, model: cfg.model ?? 'unknown' });
  messageBus.setResolveSession((id) => sessions?.get(id));

  const store = options.store;
  if (store) {
    sessions.onSessionCreated((session) => {
      attachAutoPersist(session, store);
    });
  }

  if (options.resolvePlugin && cfg.plugins) {
    for (const entry of cfg.plugins) {
      const plugin = await options.resolvePlugin(entry);
      if (plugin) await registry.register(plugin);
    }
  }
  for (const plugin of options.plugins ?? []) {
    await registry.register(plugin);
  }

  return buildRuntime(registry, sessions, channels, providers, messageBus, activity, providerConfig, store, cwd);
}
