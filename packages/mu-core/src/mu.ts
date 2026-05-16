import { newSessionId } from './ids';
import { newMessage } from './message';
import { Session } from './session';
import type {
  Channel,
  ChannelContext,
  Command,
  Hooks,
  Message,
  Plugin,
  PluginAPI,
  Provider,
  ProviderConfig,
  SystemPrompt,
  Tool,
} from './types';

export interface MuOptions {
  config: ProviderConfig;
  plugins?: Plugin[];
  pluginConfig?: Record<string, unknown>;
}

export interface SessionOptions {
  initialMessages?: Message[];
  meta?: { source?: string };
}

interface RegisteredPlugin {
  plugin: Plugin;
  unregisters: Array<() => void>;
}

function remove<T>(arr: T[], item: T): void {
  const i = arr.indexOf(item);
  if (i >= 0) arr.splice(i, 1);
}

export async function resolveSystemPrompt(prompts: SystemPrompt[], base?: string): Promise<string | undefined> {
  const parts: string[] = [];
  if (base) parts.push(base);
  for (const p of prompts) {
    const value = typeof p === 'string' ? p : await p();
    if (value) parts.push(value);
  }
  if (parts.length === 0) return undefined;
  return parts.join('\n\n');
}

export class Mu {
  /** @internal */ _config: ProviderConfig;
  /** @internal */ _hooks: Hooks[] = [];
  /** @internal */ _tools: Tool[] = [];
  /** @internal */ _providers: Provider[] = [];
  /** @internal */ _channels: Channel[] = [];
  /** @internal */ _commands: Command[] = [];
  /** @internal */ _systemPrompts: SystemPrompt[] = [];

  private _pluginConfig: Record<string, unknown>;
  private _plugins = new Map<string, RegisteredPlugin>();
  private _sessions = new Map<string, Session>();
  private _sessionListeners = new Set<(session: Session) => void>();

  private constructor(opts: MuOptions) {
    this._config = opts.config;
    this._pluginConfig = opts.pluginConfig ?? {};
    this._commands.push(helpCommand(this));
  }

  static async start(opts: MuOptions): Promise<Mu> {
    const mu = new Mu(opts);
    for (const plugin of opts.plugins ?? []) {
      await mu.use(plugin);
    }
    const ctx: ChannelContext = {
      session: (id) => mu.session(id),
      getCommand: (name) => mu._commands.find((c) => c.name === name),
      listCommands: () => mu._commands,
    };
    for (const channel of mu._channels) {
      await channel.start(ctx);
    }
    return mu;
  }

  async use(plugin: Plugin): Promise<() => Promise<void>> {
    if (this._plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered.`);
    }
    const unregisters: Array<() => void> = [];
    this._plugins.set(plugin.name, { plugin, unregisters });
    await plugin.register(this._api(plugin.name, unregisters));
    return async () => this._unuse(plugin.name);
  }

  session(id?: string, opts: SessionOptions = {}): Session {
    if (id) {
      const existing = this._sessions.get(id);
      if (existing) return existing;
    }
    const sessionId = id ?? newSessionId();
    const session = new Session({
      id: sessionId,
      mu: this,
      initialMessages: opts.initialMessages,
      source: opts.meta?.source,
    });
    this._sessions.set(sessionId, session);

    for (const fn of this._sessionListeners) {
      try {
        fn(session);
      } catch {
        /* continue */
      }
    }
    session.emit({ type: 'session_started', session });

    void this._fireSessionStart(session);
    return session;
  }

  async shutdown(): Promise<void> {
    for (const channel of this._channels) {
      if (channel.stop) {
        try {
          await channel.stop();
        } catch {
          /* continue */
        }
      }
    }
    for (const session of this._sessions.values()) {
      for (const hooks of this._hooks) {
        if (hooks.onSessionEnd) {
          try {
            await hooks.onSessionEnd(session);
          } catch {
            /* continue */
          }
        }
      }
      session.end();
    }
    this._sessions.clear();

    for (const name of Array.from(this._plugins.keys())) {
      await this._unuse(name);
    }
  }

  private async _fireSessionStart(session: Session): Promise<void> {
    for (const hooks of this._hooks) {
      if (hooks.onSessionStart) {
        try {
          await hooks.onSessionStart(session);
        } catch {
          /* continue */
        }
      }
    }
  }

  private async _unuse(name: string): Promise<void> {
    const entry = this._plugins.get(name);
    if (!entry) return;
    for (const u of entry.unregisters.splice(0)) {
      try {
        u();
      } catch {
        /* continue */
      }
    }
    if (entry.plugin.deactivate) await entry.plugin.deactivate();
    this._plugins.delete(name);
  }

  private _api(_pluginName: string, unregisters: Array<() => void>): PluginAPI {
    const track = (fn: () => void) => {
      unregisters.push(fn);
      return fn;
    };

    return {
      config: this._pluginConfig,
      hook: (hooks) => {
        this._hooks.push(hooks);
        return track(() => remove(this._hooks, hooks));
      },
      tool: (tool) => {
        this._tools.push(tool);
        return track(() => remove(this._tools, tool));
      },
      provider: (provider) => {
        this._providers.push(provider);
        return track(() => remove(this._providers, provider));
      },
      channel: (channel) => {
        this._channels.push(channel);
        return track(() => remove(this._channels, channel));
      },
      command: (command) => {
        if (this._commands.some((c) => c.name === command.name)) {
          throw new Error(`Command "${command.name}" is already registered.`);
        }
        this._commands.push(command);
        return track(() => remove(this._commands, command));
      },
      systemPrompt: (prompt) => {
        this._systemPrompts.push(prompt);
        return track(() => remove(this._systemPrompts, prompt));
      },
      createSession: (createOpts) => this.session(createOpts?.id, createOpts),
      getTool: (name) => this._tools.find((t) => t.name === name),
      getTools: () => this._tools,
      getProvider: (id) => this._providers.find((p) => p.id === id),
      getCommand: (name) => this._commands.find((c) => c.name === name),
      listCommands: () => this._commands,
      getSession: (id) => this._sessions.get(id),
      listSessions: () => Array.from(this._sessions.values()),
      onSession: (fn) => {
        this._sessionListeners.add(fn);
        return track(() => this._sessionListeners.delete(fn));
      },
    };
  }
}

function helpCommand(mu: Mu): Command {
  return {
    name: 'help',
    description: 'show available commands',
    async execute(_args, session) {
      const lines = ['Available commands:'];
      for (const cmd of mu._commands) {
        lines.push(`  /${cmd.name} — ${cmd.description}`);
      }
      await session.append(
        newMessage({
          role: 'system',
          content: lines.join('\n'),
          meta: { source: 'mu-core', visibility: 'ui', transient: true },
        }),
      );
    },
  };
}
