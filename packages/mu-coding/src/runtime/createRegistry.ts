import { createBuiltinPlugin, PluginRegistry } from 'mu-agents';
import type { ShutdownFn } from '../app/shutdown';
import type { AppConfig } from '../config/index';
import type { InkUIService } from '../tui/plugins/InkUIService';
import { discoverPluginFiles, loadConfiguredPlugin } from './pluginLoader';

interface CreateRegistryOptions {
  cwd: string;
  config: AppConfig;
  uiService: InkUIService;
  /**
   * Host shutdown is forwarded to plugins via PluginContext so a plugin (or
   * Pi extension via mu-pi-compat) calling shutdown gets the same graceful
   * path as Ctrl+C — terminal restored, plugins deactivated.
   *
   * Optional because some callers (tests, single-shot) don't have one.
   */
  shutdown?: ShutdownFn;
}

/**
 * Build the plugin config object passed into a plugin's factory.
 * Every plugin (configured or locally discovered) gets the UI service and
 * (when available) the host shutdown so tools can prompt, toast, set status
 * segments, or trigger graceful exit without extra plumbing.
 */
function buildPluginConfig(
  uiService: InkUIService,
  shutdown: ShutdownFn | undefined,
  base?: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = base ? { ...base } : {};
  merged.ui = uiService;
  if (shutdown) merged.shutdown = shutdown;
  return merged;
}

export async function createRegistry(options: CreateRegistryOptions): Promise<PluginRegistry> {
  const { cwd, config, uiService, shutdown } = options;
  const registry = new PluginRegistry({ cwd, config: {}, ui: uiService, shutdown });

  await registry.register(createBuiltinPlugin());

  // Locally dropped plugins (~/.config/mu/plugins/*.ts) go through the same
  // loader as configured ones so they receive `{ ui, shutdown }` and get
  // consistent error reporting.
  for (const filePath of discoverPluginFiles()) {
    await loadConfiguredPlugin(registry, filePath, buildPluginConfig(uiService, shutdown), uiService);
  }

  for (const entry of config.plugins ?? []) {
    const name = typeof entry === 'string' ? entry : entry.name;
    const pluginConfig = typeof entry === 'string' ? undefined : entry.config;
    await loadConfiguredPlugin(registry, name, buildPluginConfig(uiService, shutdown, pluginConfig), uiService);
  }

  return registry;
}
