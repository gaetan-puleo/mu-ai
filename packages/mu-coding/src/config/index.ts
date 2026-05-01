import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderConfig } from 'mu-provider';
import { getConfigDir } from '../paths';

// Path helpers live in `../paths` so other workspace packages (e.g.
// mu-pi-compat) can share the same XDG resolution without depending on this
// module's filesystem / config-file machinery. Re-exported for back-compat with
// existing callers that import them from `config/index`.
export { getCacheDir, getConfigDir, getDataDir, getPluginsDir } from '../paths';

export interface AppConfig extends ProviderConfig {
  plugins?: Array<string | { name: string; config?: Record<string, unknown> }>;
}

/**
 * Keys that `loadConfig`/`saveConfig` know how to materialize from `AppConfig`.
 * Used as an allow-list when seeding a fresh config.json. On `saveConfig` we
 * preserve every key already present in the file so users can keep custom
 * fields (or fields added by future versions) without losing them on round-trip.
 */
const CONFIG_FILE_KEYS = [
  'baseUrl',
  'model',
  'maxTokens',
  'temperature',
  'streamTimeoutMs',
  'systemPrompt',
  'plugins',
] as const;

function configPath(): string {
  return join(getConfigDir(), 'config.json');
}

function systemPromptPath(): string {
  return join(getConfigDir(), 'SYSTEM.md');
}

function tryRead(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf-8').trim() || undefined;
  } catch {
    return undefined;
  }
}

function tryParseJson(text: string | undefined): Partial<AppConfig> {
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function envInt(key: string): number | undefined {
  const v = process.env[key];
  if (!v) {
    return undefined;
  }
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

function envFloat(key: string): number | undefined {
  const v = process.env[key];
  if (!v) {
    return undefined;
  }
  const n = Number.parseFloat(v);
  return Number.isNaN(n) ? undefined : n;
}

export function loadConfig(cliModel?: string): AppConfig {
  const path = configPath();
  const file = tryParseJson(tryRead(path));

  const config: AppConfig = {
    baseUrl: process.env.MU_BASE_URL || file.baseUrl || 'http://localhost:8080/v1',
    model: cliModel || process.env.MU_MODEL || file.model,
    maxTokens: envInt('MU_MAX_TOKENS') ?? file.maxTokens ?? 4096,
    temperature: envFloat('MU_TEMPERATURE') ?? file.temperature ?? 0.7,
    streamTimeoutMs: envInt('MU_STREAM_TIMEOUT') ?? file.streamTimeoutMs ?? 60_000,
    systemPrompt: process.env.MU_SYSTEM_PROMPT || file.systemPrompt || tryRead(systemPromptPath()),
    plugins: file.plugins,
  };

  if (!existsSync(path)) {
    mkdirSync(getConfigDir(), { recursive: true });
    const fileConfig = Object.fromEntries(
      CONFIG_FILE_KEYS.filter((k) => file[k] !== undefined).map((k) => [k, file[k]]),
    ) as Partial<AppConfig>;
    writeFileSync(path, JSON.stringify(fileConfig, null, 2), 'utf-8');
  }

  return config;
}

/**
 * Persist `updates` to config.json, preserving any keys (known or unknown)
 * that are already present in the file. Only `undefined` values are stripped.
 */
export function saveConfig(updates: Partial<AppConfig>): void {
  const path = configPath();
  const file = tryParseJson(tryRead(path)) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...file };
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(path, JSON.stringify(merged, null, 2), 'utf-8');
}
