import { createBuiltinPlugin, PluginRegistry } from 'mu-agents';
import type { ShutdownFn } from '../app/shutdown';
import type { AppConfig } from '../config/index';
import type { InkUIService } from '../tui/plugins/InkUIService';
import { createMessageBus, type HostMessageBus } from './messageBus';
import { discoverPluginFiles, loadConfiguredPlugin } from './pluginLoader';

interface CreateRegistryOptions {
  cwd: string;
  config: AppConfig;
  uiService: InkUIService;
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

export async function createRegistry(options: CreateRegistryOptions): Promise<RegistryBundle> {
  const { cwd, config, uiService, shutdown } = options;
  const messageBus = createMessageBus();
  const registry = new PluginRegistry({ cwd, config: {}, ui: uiService, shutdown, messages: messageBus });

  await registry.register(createBuiltinPlugin());

  const inputs: PluginConfigInputs = { uiService, shutdown, appConfig: config };

  // Locally dropped plugins (~/.config/mu/plugins/*.ts) go through the same
  // loader as configured ones so they receive `{ ui, shutdown, config, model }`
  // and get consistent error reporting.
  for (const filePath of discoverPluginFiles()) {
    await loadConfiguredPlugin(registry, filePath, buildPluginConfig(inputs), uiService);
  }

  for (const entry of config.plugins ?? []) {
    const name = typeof entry === 'string' ? entry : entry.name;
    const pluginConfig = typeof entry === 'string' ? undefined : entry.config;
    await loadConfiguredPlugin(registry, name, buildPluginConfig(inputs, pluginConfig), uiService);
  }

  return { registry, messageBus };
}
