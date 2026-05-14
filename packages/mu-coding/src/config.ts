import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface MuConfig {
  baseUrl?: string;
  model?: string;
}

export function getConfigPath(): string {
  const dir = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'mu')
    : join(homedir(), '.config', 'mu');
  return join(dir, 'config.json');
}

/**
 * Load `~/.config/mu/config.json` (or `$XDG_CONFIG_HOME/mu/config.json`).
 * Unknown keys are ignored; malformed files are reported and treated as empty.
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
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[mu] failed to parse ${path}: ${msg}\n`);
    return {};
  }
}
