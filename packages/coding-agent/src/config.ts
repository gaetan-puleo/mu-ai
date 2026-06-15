import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import type { XdgDirs } from 'mu-harness';

const HOST = 'mu';

const env = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
};

export function xdgDirs(): XdgDirs {
  const home = homedir();
  return {
    configHome: env('XDG_CONFIG_HOME') ?? join(home, '.config'),
    dataHome: env('XDG_DATA_HOME') ?? join(home, '.local', 'share'),
    stateHome: env('XDG_STATE_HOME') ?? join(home, '.local', 'state'),
  };
}

const xdg = xdgDirs();
const configDir = join(xdg.configHome, HOST);
const stateDir = join(xdg.stateHome, HOST);

export const paths = {
  configFile: join(configDir, 'config.json'),
  stateFile: join(stateDir, 'state.json'),
  historyFile: join(stateDir, 'history.json'),
};

/** Declares which non-text modalities the configured model accepts. Both default off. */
export interface ModelCapabilities {
  vision?: boolean;
  audio?: boolean;
}

export interface CodingAgentConfig {
  kind?: string;
  baseUrl?: string;
  apiKey?: string;
  plugins?: string[];
  provider?: string;
  primaryAgents?: string[];
  capabilities?: ModelCapabilities;
  /** Speech-to-text model for `/voice`. When unset, `/voice` uses the currently
   * selected chat model if it supports audio; otherwise it reports unavailable. */
  voiceModel?: string;
}

export interface CodingAgentState {
  model?: string;
  thinkingVisible?: boolean;
  theme?: string;
}

const readJson = (path: string): Record<string, unknown> => {
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[coding-agent] failed to read ${path}: ${msg}\n`);
    }
    return {};
  }
};

const writeJson = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
};

export function getConfigPath(): string {
  return paths.configFile;
}

export function loadConfig(): CodingAgentConfig {
  const obj = readJson(paths.configFile);
  const out: CodingAgentConfig = {};
  if (typeof obj.kind === 'string') out.kind = obj.kind;
  if (typeof obj.baseUrl === 'string') out.baseUrl = obj.baseUrl;
  if (typeof obj.apiKey === 'string') out.apiKey = obj.apiKey;
  if (typeof obj.provider === 'string') out.provider = obj.provider;
  if (typeof obj.voiceModel === 'string') out.voiceModel = obj.voiceModel;
  if (Array.isArray(obj.plugins) && obj.plugins.every((p) => typeof p === 'string')) {
    out.plugins = obj.plugins as string[];
  }
  if (Array.isArray(obj.primaryAgents) && obj.primaryAgents.every((p) => typeof p === 'string')) {
    out.primaryAgents = obj.primaryAgents as string[];
  }
  if (typeof obj.capabilities === 'object' && obj.capabilities !== null) {
    const caps = obj.capabilities as Record<string, unknown>;
    out.capabilities = {
      vision: caps.vision === true,
      audio: caps.audio === true,
    };
  }
  return out;
}

export function saveConfig(config: CodingAgentConfig): void {
  writeJson(paths.configFile, config);
}

export function loadState(): CodingAgentState {
  const obj = readJson(paths.stateFile);
  const out: CodingAgentState = {};
  if (typeof obj.model === 'string') out.model = obj.model;
  if (typeof obj.thinkingVisible === 'boolean') out.thinkingVisible = obj.thinkingVisible;
  if (typeof obj.theme === 'string') out.theme = obj.theme;
  return out;
}

export function saveState(state: CodingAgentState): void {
  try {
    writeJson(paths.stateFile, state);
  } catch {
  }
}

const HISTORY_MAX = 500;

export function loadHistory(): string[] {
  const obj = readJson(paths.historyFile);
  const entries = (obj as { entries?: unknown }).entries;
  if (Array.isArray(entries)) return entries.filter((e): e is string => typeof e === 'string');
  return [];
}

export function appendHistory(entry: string): void {
  if (!entry.trim()) return;
  const entries = loadHistory();
  if (entries[entries.length - 1] === entry) return;
  entries.push(entry);
  const trimmed = entries.slice(-HISTORY_MAX);
  try {
    writeJson(paths.historyFile, { entries: trimmed });
  } catch {
  }
}
