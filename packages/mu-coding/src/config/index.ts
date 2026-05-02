import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderConfig } from 'mu-provider';
import type { ThemeConfig } from '../tui/theme/types';

// ─── XDG Path Helpers ─────────────────────────────────────────────────────────
//
// Path resolution lives alongside config because the config module owns the
// "where do mu's files live?" question end-to-end (config.json, SYSTEM.md,
// sessions, plugin caches). Resolved lazily so tests can stub the env after
// module import; production callers pay only one `process.env` lookup per call.

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

// ─── npm: specifier parsing ───────────────────────────────────────────────────
//
// Plugin specifiers stored in `config.plugins` use the form `npm:<bare>` where
// `<bare>` is a bun/npm package spec — possibly versioned (`foo@1.2.3`,
// `@scope/foo@^1.0.0`). Multiple call sites need to split this consistently:
// `mu install`/`mu uninstall` use it for canonicalization & version stripping;
// the runtime plugin loader uses it to resolve from
// `~/.local/share/mu/node_modules/<name>`. Centralized here so the rules
// can never drift between install-time and load-time.

/**
 * Parsed npm specifier: package name (always present, scope preserved) and an
 * optional install-time version range. Examples:
 *
 *   foo               → { name: "foo" }
 *   foo@1.2.3         → { name: "foo",         version: "1.2.3" }
 *   @scope/foo        → { name: "@scope/foo" }
 *   @scope/foo@^1.0.0 → { name: "@scope/foo",  version: "^1.0.0" }
 */
export interface ParsedNpmSpec {
  name: string;
  version?: string;
}

/** Strip the leading `@` for scoped names before searching for the version `@`. */
export function parseBareNpmSpec(bare: string): ParsedNpmSpec {
  const scoped = bare.startsWith('@');
  const at = bare.indexOf('@', scoped ? 1 : 0);
  if (at === -1) return { name: bare };
  return { name: bare.slice(0, at), version: bare.slice(at + 1) };
}

/**
 * Canonical form stored in `config.plugins`: `npm:<package-name>` with the
 * version stripped, so `npm:foo@1.2.3` and `npm:foo` deduplicate correctly.
 */
export function canonicalNpmSpecifier(bare: string): string {
  return `npm:${parseBareNpmSpec(bare).name}`;
}

export interface AppConfig extends ProviderConfig {
  plugins?: Array<string | { name: string; config?: Record<string, unknown> }>;
  /**
   * Optional per-leaf overrides on top of the built-in theme. See
   * `tui/theme/types.ts` for the available sections and color leaves.
   */
  theme?: ThemeConfig;
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
  'plugins',
  'theme',
] as const;

function configPath(): string {
  return join(getConfigDir(), 'config.json');
}

function systemPromptPath(): string {
  return join(getConfigDir(), 'SYSTEM.md');
}

/**
 * Path to the SYSTEM.md bundled with mu-coding. Used as the lowest-priority
 * fallback when no user override is configured. Resolved from this module's
 * location so it works both from `src/` (dev via bun) and any compiled layout
 * that preserves the `prompts/` sibling of `src/` or `dist/`.
 */
function bundledSystemPromptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/config/index.ts → ../../prompts/SYSTEM.md
  // dist/config/index.js → ../../prompts/SYSTEM.md
  return join(here, '..', '..', 'prompts', 'SYSTEM.md');
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
    systemPrompt: tryRead(systemPromptPath()) || tryRead(bundledSystemPromptPath()),
    plugins: file.plugins,
    theme: file.theme,
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
