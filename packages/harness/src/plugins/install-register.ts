/**
 * `installAndRegister` / `uninstallAndUnregister` — host-friendly wrappers
 * around the install primitives that also keep the host's plugin list in sync.
 *
 * Local `.ts/.mts/.js/.mjs` files are copied into `pluginsDir` and discovered
 * automatically on next boot (no config write needed). npm specs are persisted
 * via `readPlugins`/`writePlugins` so the host loads them again on restart.
 */
import { installLocalPluginFile, installNpmPlugin } from './installer';

export interface InstallRegisterOptions {
  /** Either `npm:foo`, `@scope/foo`, or a path to a local file. */
  spec: string;
  /** Plugins directory (`paths.pluginsDir`) for local-file copies. */
  pluginsDir: string;
  /** Read the host's stored plugin list (typically `config.plugins ?? []`). */
  readPlugins: () => string[];
  /** Persist the updated plugin list (typically `config.plugins = next; saveConfig()`). */
  writePlugins: (plugins: string[]) => void;
}

export interface InstallRegisterResult {
  /** True for npm/scope specs; false for local files. */
  kind: 'npm' | 'local';
  /** For npm: true if the spec was new; false if already present. For local: always true. */
  added: boolean;
  /** Message to show the user (also written to stdout when `quiet` is unset). */
  message: string;
}

const isNpmSpec = (spec: string): boolean => spec.startsWith('npm:') || spec.startsWith('@');

export async function installAndRegister(opts: InstallRegisterOptions): Promise<InstallRegisterResult> {
  const { spec } = opts;
  if (isNpmSpec(spec)) {
    await installNpmPlugin(spec);
    const plugins = opts.readPlugins();
    if (plugins.includes(spec)) {
      return { kind: 'npm', added: false, message: `${spec} is already installed` };
    }
    opts.writePlugins([...plugins, spec]);
    return { kind: 'npm', added: true, message: `installed ${spec}` };
  }
  const dest = installLocalPluginFile(spec, opts.pluginsDir);
  return { kind: 'local', added: true, message: `installed ${dest}` };
}

export interface UninstallRegisterOptions {
  /** Must be an npm/scope spec — local files have no registry entry to remove. */
  spec: string;
  readPlugins: () => string[];
  writePlugins: (plugins: string[]) => void;
}

export interface UninstallRegisterResult {
  removed: boolean;
  message: string;
}

export function uninstallAndUnregister(opts: UninstallRegisterOptions): UninstallRegisterResult {
  const { spec } = opts;
  if (!isNpmSpec(spec)) {
    throw new Error(`uninstall expects an npm:<spec> or @-scoped spec; got ${spec}`);
  }
  const plugins = opts.readPlugins();
  if (!plugins.includes(spec)) {
    return { removed: false, message: `${spec} is not installed` };
  }
  opts.writePlugins(plugins.filter((p) => p !== spec));
  return { removed: true, message: `uninstalled ${spec}` };
}
