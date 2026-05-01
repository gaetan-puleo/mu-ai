#!/usr/bin/env bun
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { render } from 'ink';
import { createBuiltinPlugin, PluginRegistry } from 'mu-agents';
import { parseArgs, resolveInitialMessages } from './cli';
import { type AppConfig, getDataDir, getPluginsDir, loadConfig } from './config';
import { runSingleShot } from './singleShot';
import { handleSubcommand } from './subcommands';
import { ChatPanel } from './tui/components/chat/ChatPanel';
import { InkUIService } from './tui/services/uiService';

function discoverPluginFiles(): string[] {
  const dir = getPluginsDir();
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Resolve an npm: specifier to an absolute path via the data dir's node_modules.
 */
function formatPluginError(name: string, err: unknown): string {
  const parts: string[] = [`Plugin "${name}" failed`];
  let current: unknown = err;
  while (current) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(': ');
}

function resolveNpmPlugin(specifier: string): string {
  const bare = specifier.slice(4);
  const dataDir = getDataDir();
  try {
    const require = createRequire(resolve(dataDir, 'package.json'));
    return require.resolve(bare);
  } catch (err) {
    throw new Error(`Cannot resolve "${bare}" from ${dataDir}/node_modules — is it installed?`, { cause: err });
  }
}

/**
 * Load a plugin by name or path, resolving from this package's context.
 * This allows workspace packages (like mu-pi-compat) to be found even though
 * mu-agents' registry can't resolve them from its own location.
 *
 * Plugins prefixed with npm: are resolved from ~/.local/share/mu/node_modules/.
 */
async function loadPluginFromHere(
  registry: PluginRegistry,
  name: string,
  pluginConfig?: Record<string, unknown>,
  uiService?: InkUIService,
): Promise<void> {
  try {
    const target = name.startsWith('npm:') ? resolveNpmPlugin(name) : name;
    const mod = await import(target);
    const factory = mod.default ?? mod.createPlugin;

    if (typeof factory === 'function') {
      const plugin = factory(pluginConfig ?? {});
      await registry.register(plugin);
    } else if (typeof mod === 'object' && mod !== null && 'name' in mod) {
      await registry.register(mod);
    } else {
      const exportKeys = Object.keys(mod).join(', ') || '(none)';
      uiService?.notify(`Plugin "${name}": no plugin export found. Exports: [${exportKeys}]`, 'error');
    }
  } catch (err) {
    // npm: plugins don't fall back — they must resolve from data dir
    if (name.startsWith('npm:')) {
      uiService?.notify(formatPluginError(name, err), 'error');
      return;
    }
    // Non-npm plugins fall back to registry loader (for file paths)
    try {
      await registry.loadPlugin(name, pluginConfig);
    } catch (fallbackErr) {
      uiService?.notify(formatPluginError(name, fallbackErr), 'error');
    }
  }
}

async function createRegistry(cwd: string, config: AppConfig, uiService: InkUIService) {
  const registry = new PluginRegistry({ cwd, config: {} });

  // Register built-in tools (read, write, edit, bash)
  await registry.register(createBuiltinPlugin());

  // Auto-load .ts plugin files from ~/.config/mu/plugins/
  for (const filePath of discoverPluginFiles()) {
    await registry.loadPlugin(filePath);
  }

  // Load configured plugins
  if (config.plugins?.length) {
    for (const entry of config.plugins) {
      const name = typeof entry === 'string' ? entry : entry.name;
      const pluginConfig = typeof entry === 'string' ? undefined : entry.config;

      // Inject uiService for plugins that accept it (duck typing)
      const finalConfig = pluginConfig ? { ...pluginConfig, ui: uiService } : { ui: uiService };

      await loadPluginFromHere(registry, name, finalConfig, uiService);
    }
  }

  return registry;
}

async function main() {
  if (await handleSubcommand()) return;

  const cliArgs = parseArgs();
  const config = loadConfig(cliArgs.model);
  const root = process.cwd();

  const uiService = new InkUIService();
  const registry = await createRegistry(root, config, uiService);

  if (cliArgs.prompt) {
    try {
      await runSingleShot(cliArgs.prompt, config, registry);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`Error: ${msg}`);
      process.exit(1);
    } finally {
      await registry.shutdown();
    }
    return;
  }

  const initialMessages = resolveInitialMessages(cliArgs);

  render(<ChatPanel config={config} initialMessages={initialMessages} registry={registry} uiService={uiService} />, {
    exitOnCtrlC: false,
    kittyKeyboard: { mode: 'enabled' },
  });

  process.on('exit', () => {
    registry.shutdown();
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
