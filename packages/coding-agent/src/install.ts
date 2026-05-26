/**
 * Thin wrapper around harness install/uninstall helpers. Records npm specs
 * into coding-agent's config so they're auto-loaded on next start.
 */
import { createXdgPaths, installLocalPluginFile, installNpmPlugin } from 'mu-harness';
import { loadConfig, saveConfig } from './config';

export async function install(spec: string): Promise<void> {
  if (spec.startsWith('npm:') || spec.startsWith('@')) {
    await installNpmPlugin(spec);
    const config = loadConfig();
    const plugins = config.plugins ?? [];
    if (plugins.includes(spec)) {
      process.stdout.write(`[mu] ${spec} is already installed\n`);
      return;
    }
    config.plugins = [...plugins, spec];
    saveConfig(config);
    process.stdout.write(`[mu] installed ${spec}\n`);
    return;
  }
  const paths = createXdgPaths('mu');
  const dest = installLocalPluginFile(spec, paths.pluginsDir);
  process.stdout.write(`[mu] installed ${dest}\n`);
}

export function uninstall(spec: string): void {
  if (!spec.startsWith('npm:') && !spec.startsWith('@')) {
    throw new Error(`uninstall expects an npm:<spec> or @-scoped spec; got ${spec}`);
  }
  const config = loadConfig();
  const plugins = config.plugins ?? [];
  if (!plugins.includes(spec)) {
    process.stderr.write(`[mu] ${spec} is not installed\n`);
    return;
  }
  config.plugins = plugins.filter((p) => p !== spec);
  saveConfig(config);
  process.stdout.write(`[mu] uninstalled ${spec}\n`);
}
