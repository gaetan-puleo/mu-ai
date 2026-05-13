import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ProviderConfig } from 'mu-core';

const HOME = homedir();

export function getConfigDir(): string {
  return process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, 'mu') : join(HOME, '.config', 'mu');
}

export function getDataDir(): string {
  return process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, 'mu') : join(HOME, '.local', 'share', 'mu');
}

export function getSessionsDir(): string {
  return join(getDataDir(), 'sessions');
}

export function getAgentsDir(): string {
  return join(getConfigDir(), 'agents');
}

export function getPluginsDir(): string {
  return join(getConfigDir(), 'plugins');
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export function getSystemPromptPath(): string {
  return join(getConfigDir(), 'SYSTEM.md');
}

export interface MuConfig extends Partial<ProviderConfig> {
  /** Plugin specifiers to load (currently informational; main.ts wires built-ins). */
  plugins?: string[];
}

// Only `baseUrl` is defaulted. Every other field is intentionally left
// undefined so the user's config (or runtime selection) is the sole
// source of truth:
//   - `model`          → picked at runtime via `GET /v1/models`
//   - `maxTokens`      → server / model decides
//   - `temperature`    → server / model default
//   - `streamTimeoutMs`→ provider applies its own fallback (60s)
const DEFAULTS: ProviderConfig = {
  baseUrl: 'http://localhost:11434/v1',
};

export function loadConfig(): ProviderConfig {
  ensureDir(getConfigDir());
  const path = getConfigPath();
  let file: MuConfig = {};
  if (existsSync(path)) {
    try {
      file = JSON.parse(readFileSync(path, 'utf-8')) as MuConfig;
    } catch {
      // ignore malformed config; fall back to defaults
    }
  }

  const promptPath = getSystemPromptPath();
  const systemPrompt = existsSync(promptPath) ? readFileSync(promptPath, 'utf-8').trim() : undefined;

  return {
    ...DEFAULTS,
    ...file,
    systemPrompt: systemPrompt ?? file.systemPrompt ?? DEFAULTS.systemPrompt,
  };
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function writeJSON(path: string, value: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8');
}
