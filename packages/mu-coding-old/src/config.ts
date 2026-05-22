import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface MuConfig {
  baseUrl?: string;
  model?: string;
  /**
   * Names of optional plugins to enable. Valid values today:
   *   - "mu-agents"          — activates the agents runtime (mention dispatch,
   *                            permission gating, sub-agent tools).
   *   - "mu-coding-agents"   — contributes the bundled build/plan/explore/
   *                            review agents (requires "mu-agents" to also
   *                            be listed).
   *
   * `mu-tools` is always enabled and is rejected if listed here. Unknown
   * entries are warned about and dropped.
   */
  plugins?: string[];
}

export function getConfigPath(): string {
  const dir = process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, 'mu') : join(homedir(), '.config', 'mu');
  return join(dir, 'config.json');
}

/**
 * Load `~/.config/mu/config.json` (or `$XDG_CONFIG_HOME/mu/config.json`).
 * Unknown keys are ignored; malformed files are reported and treated as empty.
 *
 * The `plugins` field is parsed defensively: non-array values are dropped,
 * non-string entries are filtered out. Validation of *which* plugin names are
 * meaningful lives in `assemblePlugins` — keeping it here would require this
 * module to know about every optional plugin.
 */
export function loadConfig(): MuConfig {
  const path = getConfigPath();
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const obj = raw as Record<string, unknown>;
    const out: MuConfig = {};
    if (typeof obj.baseUrl === 'string') out.baseUrl = obj.baseUrl;
    if (typeof obj.model === 'string') out.model = obj.model;
    if (Array.isArray(obj.plugins)) {
      const plugins: string[] = [];
      for (const entry of obj.plugins) {
        if (typeof entry === 'string') plugins.push(entry);
      }
      out.plugins = plugins;
    }
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[mu] failed to parse ${path}: ${msg}\n`);
    return {};
  }
}
