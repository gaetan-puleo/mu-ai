/**
 * Thin host bindings for harness's install/uninstall registry helpers.
 * The actual install + config-write logic lives in mu-harness; this file
 * just supplies the coding-agent `paths` + config read/write.
 */
import { createXdgPaths, installAndRegister, uninstallAndUnregister } from 'mu-harness';
import { loadConfig, saveConfig } from './config';

const readPlugins = (): string[] => loadConfig().plugins ?? [];

const writePlugins = (plugins: string[]): void => {
  const config = loadConfig();
  config.plugins = plugins;
  saveConfig(config);
};

export async function install(spec: string): Promise<void> {
  const paths = createXdgPaths('mu');
  const result = await installAndRegister({ spec, pluginsDir: paths.pluginsDir, readPlugins, writePlugins });
  process.stdout.write(`[mu] ${result.message}\n`);
}

export function uninstall(spec: string): void {
  const result = uninstallAndUnregister({ spec, readPlugins, writePlugins });
  const stream = result.removed ? process.stdout : process.stderr;
  stream.write(`[mu] ${result.message}\n`);
}
