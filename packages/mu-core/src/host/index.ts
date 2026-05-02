/**
 * `startMu` — generic host bootstrap. Loads a config, builds the plugin
 * registry with the new side-channel registries (providers/channels/sessions/
 * activity/agents), activates plugins (config first then code-passed), starts
 * channels, and returns a handle for shutdown.
 *
 * Designed for non-coding hosts (Arya etc.). mu-coding currently keeps its
 * own bootstrap (Ink TUI lifecycle) and may migrate to this entry point in a
 * later iteration.
 */

import type { ActivityBus } from '../activity';
import { createActivityBus } from '../activity';
import type { ChannelRegistry } from '../channel';
import { createChannelRegistry } from '../channel';
import type { Plugin } from '../plugin';
import type { ProviderRegistry } from '../provider/registry';
import { createProviderRegistry } from '../provider/registry';
import { PluginRegistry } from '../registry';
import type { SessionManager } from '../session';
import { createSessionManager } from '../session';
import type { ProviderConfig } from '../types/llm';

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

export interface StartMuOptions {
  configPath?: string;
  /** In-memory config — takes precedence over `configPath` when provided. */
  config?: MuConfigShape;
  /** Plugins passed in code (activated after config-listed plugins). */
  plugins?: Plugin[];
  /** Cwd default (overrides config.cwd if set). */
  cwd?: string;
  /**
   * Resolves a `config.plugins` entry to a Plugin instance. Hosts (mu-coding,
   * Arya) plug their own loader here — typically supports `npm:<name>`
   * specifiers, absolute paths, etc. When omitted, config.plugins is ignored.
   */
  resolvePlugin?: (entry: string | { name: string; config?: Record<string, unknown> }) => Promise<Plugin | null>;
}

export interface MuHandle {
  registry: PluginRegistry;
  sessions: SessionManager;
  channels: ChannelRegistry;
  activity: ActivityBus;
  providers: ProviderRegistry;
  shutdown: () => Promise<void>;
}

async function loadConfig(opts: StartMuOptions): Promise<MuConfigShape> {
  if (opts.config) return opts.config;
  if (!opts.configPath) return {};
  const { readFileSync, existsSync } = await import('node:fs');
  if (!existsSync(opts.configPath)) return {};
  const text = readFileSync(opts.configPath, 'utf8');
  return JSON.parse(text) as MuConfigShape;
}

export async function startMu(options: StartMuOptions = {}): Promise<MuHandle> {
  const cfg = await loadConfig(options);
  const cwd = options.cwd ?? cfg.cwd ?? process.cwd();

  const providers = createProviderRegistry();
  const channels = createChannelRegistry();
  const activity = createActivityBus();

  const providerConfig: ProviderConfig = {
    baseUrl: cfg.baseUrl ?? 'http://localhost:11434/v1',
    model: cfg.model,
    maxTokens: cfg.maxTokens ?? 4096,
    temperature: cfg.temperature ?? 0.7,
    streamTimeoutMs: cfg.streamTimeoutMs ?? 60_000,
    systemPrompt: cfg.systemPrompt,
  };

  // Build a placeholder for sessions injected after construction (circular:
  // SessionManager needs the registry, plugins want to see SessionManager).
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
  });

  sessions = createSessionManager({ registry, config: providerConfig, model: cfg.model ?? 'unknown' });

  // Activate config-listed plugins via the host's resolver. mu-coding wires
  // its npm:/path loader; minimal hosts may omit and pass plugins in code.
  if (options.resolvePlugin && cfg.plugins) {
    for (const entry of cfg.plugins) {
      const plugin = await options.resolvePlugin(entry);
      if (plugin) await registry.register(plugin);
    }
  }
  // Activate code-passed plugins after config-listed ones (so code overrides
  // config-driven hooks compose-wise).
  for (const plugin of options.plugins ?? []) {
    await registry.register(plugin);
  }

  await channels.startAll();

  const sm = sessions;
  return {
    registry,
    sessions: sm,
    channels,
    activity,
    providers,
    async shutdown() {
      await channels.stopAll();
      for (const s of sm.list()) s.abort();
    },
  };
}
