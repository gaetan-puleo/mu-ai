#!/usr/bin/env bun
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { render } from 'ink';
import { createBuiltinPlugin, PluginRegistry } from 'mu-agents';
import { parseArgs, resolveInitialMessages } from './cli';
import { type AppConfig, getPluginsDir, loadConfig } from './config';
import { runSingleShot } from './singleShot';
import { ChatPanel } from './tui/components/chat/ChatPanel';

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

async function createRegistry(cwd: string, config: AppConfig) {
  const registry = new PluginRegistry({ cwd, config: {} });

  // Register built-in tools (read, write, edit, bash)
  await registry.register(createBuiltinPlugin());

  // Auto-load .ts plugin files from ~/.config/mu/plugins/
  for (const filePath of discoverPluginFiles()) {
    await registry.loadPlugin(filePath);
  }

  // Load npm package plugins from config
  if (config.plugins?.length) {
    for (const entry of config.plugins) {
      const name = typeof entry === 'string' ? entry : entry.name;
      const pluginConfig = typeof entry === 'string' ? undefined : entry.config;
      await registry.loadPlugin(name, pluginConfig);
    }
  }

  return registry;
}

async function main() {
  const cliArgs = parseArgs();
  const config = loadConfig(cliArgs.model);
  const root = process.cwd();

  const registry = await createRegistry(root, config);

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

  render(<ChatPanel config={config} initialMessages={initialMessages} registry={registry} />, {
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
