import process from 'node:process';
import { importModule, type Plugin } from 'mu-harness';
import { loadConfig, saveConfig } from './config';

const isPlugin = (value: unknown): value is Plugin =>
  typeof value === 'object' && value !== null && typeof (value as { name?: unknown }).name === 'string';

export async function loadPlugins(specs: string[] = []): Promise<Plugin[]> {
  const plugins: Plugin[] = [];
  for (const spec of specs) {
    try {
      const mod = await importModule(spec);
      const candidate = mod.default ?? mod.plugin ?? mod;
      if (isPlugin(candidate)) {
        plugins.push(candidate);
      } else {
        process.stderr.write(`[mu] plugin "${spec}" has no valid default export (expected { name, ... })\n`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[mu] failed to load plugin "${spec}": ${msg}\n`);
    }
  }
  return plugins;
}

export function installPlugin(spec: string): void {
  const config = loadConfig();
  const plugins = config.plugins ?? [];
  if (plugins.includes(spec)) {
    process.stdout.write(`[mu] plugin already registered: ${spec}\n`);
    return;
  }
  config.plugins = [...plugins, spec];
  saveConfig(config);
  process.stdout.write(`[mu] registered plugin: ${spec}\n`);
}

export function uninstallPlugin(spec: string): void {
  const config = loadConfig();
  const plugins = config.plugins ?? [];
  if (!plugins.includes(spec)) {
    process.stderr.write(`[mu] plugin not registered: ${spec}\n`);
    return;
  }
  config.plugins = plugins.filter((p) => p !== spec);
  saveConfig(config);
  process.stdout.write(`[mu] unregistered plugin: ${spec}\n`);
}
