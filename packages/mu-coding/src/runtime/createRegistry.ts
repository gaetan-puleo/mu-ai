import { createAgentsPlugin } from 'mu-agents';
import type { ChatMessage } from 'mu-core';
import {
  type ActivityBus,
  type ChannelRegistry,
  createActivityBus,
  createChannelRegistry,
  createProviderRegistry,
  PluginRegistry,
  type ProviderRegistry,
} from 'mu-core';
import { createOpenAIProviderPlugin } from 'mu-openai-provider';
import type { ShutdownFn } from '../app/shutdown';
import type { AppConfig } from '../config/index';
import { createCodingPlugin } from '../plugin';
import type { InkUIService } from '../tui/plugins/InkUIService';
import { createMessageBus, type HostMessageBus } from './messageBus';
import { discoverPluginFiles, loadConfiguredPlugin } from './pluginLoader';

interface CreateRegistryOptions {
  cwd: string;
  config: AppConfig;
  uiService: InkUIService;
  /**
   * Initial transcript injected into the TUI's session (e.g. resumed from
   * disk via `mu -c`). Threaded through to the coding plugin's TUI channel.
   */
  initialMessages?: ChatMessage[];
  /**
   * Host shutdown is forwarded to plugins via PluginContext so a plugin
   * calling shutdown gets the same graceful path as Ctrl+C — terminal
   * restored, plugins deactivated.
   *
   * Optional because some callers (tests, single-shot) don't have one.
   */
  shutdown?: ShutdownFn;
}

interface RegistryBundle {
  registry: PluginRegistry;
  messageBus: HostMessageBus;
  providers: ProviderRegistry;
  channels: ChannelRegistry;
  activity: ActivityBus;
}

interface PluginConfigInputs {
  uiService: InkUIService;
  shutdown: ShutdownFn | undefined;
  appConfig: AppConfig;
}

/**
 * Build the plugin config object passed into a plugin's factory.
 * Every plugin (configured or locally discovered) receives:
 *  - `ui` — UIService for dialogs/toasts/status
 *  - `shutdown` — graceful shutdown hook (when available)
 *  - `config` — the host's ProviderConfig snapshot (baseUrl, model, …) so
 *    plugins that need to call the LLM (e.g. subagents) don't have to be
 *    re-configured manually
 *  - `model` — the host's currently configured model id
 */
function buildPluginConfig(inputs: PluginConfigInputs, base?: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = base ? { ...base } : {};
  merged.ui = inputs.uiService;
  if (inputs.shutdown) merged.shutdown = inputs.shutdown;
  // Forward provider info so plugins can re-issue LLM calls (e.g. subagents)
  // without forcing users to duplicate `baseUrl`/`model` in plugin config.
  if (!('config' in merged)) merged.config = inputs.appConfig;
  if (!('model' in merged) && inputs.appConfig.model) merged.model = inputs.appConfig.model;
  return merged;
}

/**
 * Fallback shutdown used when the host (typically tests) doesn't supply one.
 * Logs a warning when a plugin actually invokes it: production hosts always
 * pass the real `registerShutdown(...)` handle, so an invocation here means
 * either the test setup forgot to mock the plugin's shutdown call or a
 * plugin is reaching for `ctx.shutdown()` in an environment that can't honour
 * it. Resolves cleanly so the calling plugin sees no behavioural change.
 */
async function noopShutdown(code?: number): Promise<void> {
  console.warn(`[mu-coding] noopShutdown invoked (code=${code ?? 0}); host did not register a real shutdown handler.`);
}

/**
 * Wire mu-coding's standard plugin set:
 *  1. mu-openai-provider — registers the OpenAI streaming provider
 *  2. mu-agents          — agent switcher + permissions + approval gateway
 *  3. mu-coding          — coding tools + TUI channel + Ink approval channel
 *                          (registered against mu-agents' gateway)
 *
 * Order matters: mu-coding must activate *after* mu-agents so the approval
 * channel finds the gateway via `ctx.getPlugin('mu-agents')`.
 *
 * Optional plugins (mu-coding-agents, mu-repomap, …) are opt-in via
 * `config.plugins` and loaded below by `loadConfiguredPlugin`.
 */
async function registerBuiltins(
  registry: PluginRegistry,
  options: CreateRegistryOptions,
  inputs: PluginConfigInputs,
  messageBus: HostMessageBus,
): Promise<void> {
  await registry.register(createOpenAIProviderPlugin());
  await registry.register(
    createAgentsPlugin({
      config: options.config,
      model: options.config.model,
      approvalChannelId: 'tui',
    }),
  );
  await registry.register(
    createCodingPlugin({
      appConfig: options.config,
      initialMessages: options.initialMessages,
      messageBus,
      uiService: options.uiService,
      shutdown: options.shutdown ?? noopShutdown,
      // Pass the concrete registry: the TUI subscribes to renderer / shortcut
      // / status streams that are not part of the narrow `PluginRegistryView`
      // exposed via `ctx.registry`.
      registry,
    }),
  );
  // Silence unused-input warning when no configured/local plugins exist.
  void inputs;
}

export async function createRegistry(options: CreateRegistryOptions): Promise<RegistryBundle> {
  const { cwd, config, uiService, shutdown } = options;
  const messageBus = createMessageBus();
  const providers = createProviderRegistry();
  const channels = createChannelRegistry();
  const activity = createActivityBus();
  const registry = new PluginRegistry({
    cwd,
    config: {},
    ui: uiService,
    shutdown,
    messages: messageBus,
    providers,
    channels,
    activity,
  });

  const inputs: PluginConfigInputs = { uiService, shutdown, appConfig: config };

  await registerBuiltins(registry, options, inputs, messageBus);

  // User-extension plugins ride on top of the builtins.
  for (const filePath of discoverPluginFiles()) {
    await loadConfiguredPlugin(registry, filePath, buildPluginConfig(inputs), uiService);
  }

  for (const entry of config.plugins ?? []) {
    const name = typeof entry === 'string' ? entry : entry.name;
    const pluginConfig = typeof entry === 'string' ? undefined : entry.config;
    await loadConfiguredPlugin(registry, name, buildPluginConfig(inputs, pluginConfig), uiService);
  }

  return { registry, messageBus, providers, channels, activity };
}
