import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { Plugin } from 'mu-core';
import { runInstall } from '../cli/install';
import { getDataDir, getPluginsDir } from '../config';

export async function loadConfiguredPlugins(specs: string[]): Promise<Plugin[]> {
  const out: Plugin[] = [];
  const root = getDataDir();

  for (const spec of specs) {
    if (spec.startsWith('npm:')) {
      const bare = spec.slice('npm:'.length);
      const pkgName = bare.split('@')[0] ?? bare;
      const target = join(root, 'node_modules', pkgName);
      if (!existsSync(target)) {
        await runInstall([spec]);
      }
      const plugin = await tryImport(target);
      if (plugin) out.push(plugin);
    } else {
      const path = isAbsolute(spec) ? spec : resolve(spec);
      const plugin = await tryImport(path);
      if (plugin) out.push(plugin);
    }
  }

  // Auto-load loose plugin files in ~/.config/mu/plugins/*.{ts,js}
  const pluginsDir = getPluginsDir();
  if (existsSync(pluginsDir) && statSync(pluginsDir).isDirectory()) {
    for (const file of readdirSync(pluginsDir)) {
      if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
      const plugin = await tryImport(join(pluginsDir, file));
      if (plugin) out.push(plugin);
    }
  }

  return out;
}

async function tryImport(path: string): Promise<Plugin | null> {
  try {
    const mod = (await import(path)) as { default?: unknown; createPlugin?: unknown };
    const factory = mod.default ?? mod.createPlugin;
    if (typeof factory === 'function') {
      const result = (factory as () => Plugin | Promise<Plugin>)();
      return await result;
    }
    return null;
  } catch (err) {
    process.stderr.write(`[mu] failed to load plugin from ${path}: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
}
