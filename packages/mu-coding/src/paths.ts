import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * XDG Base Directory paths for mu.
 *
 * Resolved lazily so tests can stub the env after module import. Production
 * callers pay only one `process.env` lookup per call.
 *
 * Exposed under the `mu-coding/paths` subpath export so other workspace
 * packages (e.g. `mu-pi-compat`) can share the same resolution logic without
 * pulling in the TUI / config-file / session machinery.
 */
const HOME = homedir();

export function getConfigDir(): string {
  return process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, 'mu') : join(HOME, '.config', 'mu');
}

export function getDataDir(): string {
  return process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, 'mu') : join(HOME, '.local', 'share', 'mu');
}

export function getCacheDir(): string {
  return process.env.XDG_CACHE_HOME ? join(process.env.XDG_CACHE_HOME, 'mu') : join(HOME, '.cache', 'mu');
}

export function getPluginsDir(): string {
  return join(getConfigDir(), 'plugins');
}
