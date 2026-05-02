import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import type { Plugin, PluginRegistry } from 'mu-core';
import { installNpmPackage } from '../cli/install';
import { getDataDir, getPluginsDir, parseBareNpmSpec } from '../config/index';
import type { InkUIService } from '../tui/plugins/InkUIService';

export function discoverPluginFiles(): string[] {
  const dir = getPluginsDir();
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

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

/**
 * Resolve an `npm:<spec>` plugin specifier to an absolute path on disk.
 *
 * If the package isn't installed yet, runs `bun add <spec>` against the mu
 * data dir and retries — so users can list a plugin in `config.plugins`
 * without having to invoke `mu install` first.
 *
 * `uiService` is optional: when provided, surface "Installing …" / failure
 * messages through the TUI; otherwise fall back to stderr so the host's
 * boot log still shows what happened.
 */
async function resolveNpmPlugin(specifier: string, uiService?: InkUIService): Promise<string> {
  const bare = specifier.slice(4);
  const { name } = parseBareNpmSpec(bare);
  const dataDir = getDataDir();
  const require = createRequire(resolve(dataDir, 'package.json'));

  try {
    return require.resolve(name);
  } catch (_firstErr) {
    const installMsg = `Installing ${name}…`;
    if (uiService) uiService.notify(installMsg, 'info');
    else console.error(`[mu] ${installMsg}`);

    try {
      installNpmPackage(bare, { silent: true });
    } catch (installErr) {
      throw new Error(`Failed to auto-install "${name}" into ${dataDir}/node_modules`, { cause: installErr });
    }

    try {
      return require.resolve(name);
    } catch (retryErr) {
      throw new Error(
        `Auto-installed "${name}" but cannot resolve it from ${dataDir}/node_modules — install may have failed silently`,
        { cause: retryErr },
      );
    }
  }
}

function isPluginShape(value: unknown): value is Plugin {
  return typeof value === 'object' && value !== null && 'name' in value && typeof (value as Plugin).name === 'string';
}

/**
 * Extract a plugin from a loaded module. Tries (in order):
 *   1. `module.default` as a factory function
 *   2. `module.createPlugin` as a factory function
 *   3. `module.default` as a Plugin object
 *   4. `module` as a Plugin object
 *
 * Returns `null` if no plugin shape matches; the caller should report this
 * with the list of available exports for debugging.
 */
function extractPlugin(mod: Record<string, unknown>, pluginConfig: Record<string, unknown>): Plugin | null {
  const factory = (mod.default ?? mod.createPlugin) as unknown;
  if (typeof factory === 'function') {
    const result = (factory as (cfg: Record<string, unknown>) => unknown)(pluginConfig);
    return isPluginShape(result) ? result : null;
  }
  if (isPluginShape(mod.default)) {
    return mod.default;
  }
  if (isPluginShape(mod)) {
    return mod;
  }
  return null;
}

/**
 * Loader variant that *resolves* (imports + extracts) a plugin without
 * registering it. Used by hosts driving `startMu({ resolvePlugin })`. Errors
 * surface via `uiService` (or are swallowed when omitted) so the host's
 * boot log behaviour matches `loadConfiguredPlugin`.
 */
export async function resolveConfiguredPlugin(
  name: string,
  pluginConfig?: Record<string, unknown>,
  uiService?: InkUIService,
): Promise<Plugin | null> {
  const config = pluginConfig ?? {};
  let target: string;
  try {
    target = name.startsWith('npm:') ? await resolveNpmPlugin(name, uiService) : name;
  } catch (err) {
    uiService?.notify(formatPluginError(name, err), 'error');
    return null;
  }
  let mod: Record<string, unknown>;
  try {
    mod = (await import(target)) as Record<string, unknown>;
  } catch (err) {
    uiService?.notify(formatPluginError(name, err), 'error');
    return null;
  }
  const plugin = extractPlugin(mod, config);
  if (!plugin) {
    const exportKeys = Object.keys(mod).join(', ') || '(none)';
    uiService?.notify(`Plugin "${name}": no plugin export found. Exports: [${exportKeys}]`, 'error');
    return null;
  }
  return plugin;
}

export async function loadConfiguredPlugin(
  registry: PluginRegistry,
  name: string,
  pluginConfig?: Record<string, unknown>,
  uiService?: InkUIService,
): Promise<void> {
  const plugin = await resolveConfiguredPlugin(name, pluginConfig, uiService);
  if (!plugin) return;
  try {
    await registry.register(plugin);
  } catch (err) {
    uiService?.notify(formatPluginError(name, err), 'error');
  }
}
