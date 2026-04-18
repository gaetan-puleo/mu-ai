import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProviderConfig } from 'mu-provider';

export interface AppConfig extends ProviderConfig {
  plugins?: Array<string | { name: string; config?: Record<string, unknown> }>;
}

export function getPluginsDir(): string {
  return join(CONFIG_DIR, 'plugins');
}

// XDG Base Directory paths
const HOME = homedir();
const CONFIG_DIR = process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, 'mu') : join(HOME, '.config', 'mu');
const DATA_DIR = process.env.XDG_DATA_HOME
  ? join(process.env.XDG_DATA_HOME, 'mu')
  : join(HOME, '.local', 'share', 'mu');
const CACHE_DIR = process.env.XDG_CACHE_HOME ? join(process.env.XDG_CACHE_HOME, 'mu') : join(HOME, '.cache', 'mu');

const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const SYSTEM_PROMPT_PATH = join(CONFIG_DIR, 'SYSTEM.md');

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getDataDir(): string {
  return DATA_DIR;
}

export function getCacheDir(): string {
  return CACHE_DIR;
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
  const file = tryParseJson(tryRead(CONFIG_PATH));

  const config: AppConfig = {
    baseUrl: process.env.MU_BASE_URL || file.baseUrl || 'http://localhost:8080/v1',
    model: cliModel || process.env.MU_MODEL || file.model,
    maxTokens: envInt('MU_MAX_TOKENS') ?? file.maxTokens ?? 4096,
    temperature: envFloat('MU_TEMPERATURE') ?? file.temperature ?? 0.7,
    streamTimeoutMs: envInt('MU_STREAM_TIMEOUT') ?? file.streamTimeoutMs ?? 60_000,
    systemPrompt: process.env.MU_SYSTEM_PROMPT || file.systemPrompt || tryRead(SYSTEM_PROMPT_PATH),
    plugins: file.plugins,
  };

  if (!existsSync(CONFIG_PATH)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    const KEYS = [
      'baseUrl',
      'model',
      'maxTokens',
      'temperature',
      'streamTimeoutMs',
      'systemPrompt',
      'plugins',
    ] as const;
    const fileConfig = Object.fromEntries(
      KEYS.filter((k) => file[k] !== undefined).map((k) => [k, file[k]]),
    ) as Partial<AppConfig>;
    writeFileSync(CONFIG_PATH, JSON.stringify(fileConfig, null, 2), 'utf-8');
  }

  return config;
}

export function saveConfig(updates: Partial<AppConfig>): void {
  const file = tryParseJson(tryRead(CONFIG_PATH));
  const merged = { ...file, ...updates };
  const KEYS = ['baseUrl', 'model', 'maxTokens', 'temperature', 'streamTimeoutMs', 'systemPrompt', 'plugins'] as const;
  const fileConfig = Object.fromEntries(
    KEYS.filter((k) => merged[k] !== undefined).map((k) => [k, merged[k]]),
  ) as Partial<AppConfig>;
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(fileConfig, null, 2), 'utf-8');
}
