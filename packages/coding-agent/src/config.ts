import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createXdgPaths } from 'mu-harness';

const paths = createXdgPaths('mu');

export interface CodingAgentConfig {
  kind?: string;
  baseUrl?: string;
  plugins?: string[];
  provider?: string;
}

export interface CodingAgentState {
  model?: string;
  thinkingVisible?: boolean;
  /** Name of the active primary agent (when several are defined). */
  activeAgent?: string;
}

function loadJson<T>(path: string, validate: (obj: Record<string, unknown>) => T): T {
  if (!existsSync(path)) return validate({});
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return validate({});
    return validate(raw as Record<string, unknown>);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[coding-agent] failed to parse ${path}: ${msg}\n`);
    return validate({});
  }
}

function saveJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

export function getConfigPath(): string {
  return paths.configFile;
}

export function getStatePath(): string {
  return paths.stateFile;
}

export function getPluginsDir(): string {
  return paths.pluginsDir;
}

export function loadConfig(): CodingAgentConfig {
  return loadJson(getConfigPath(), (obj) => {
    const out: CodingAgentConfig = {};
    if (typeof obj.kind === 'string') out.kind = obj.kind;
    if (typeof obj.baseUrl === 'string') out.baseUrl = obj.baseUrl;
    if (Array.isArray(obj.plugins) && obj.plugins.every((p) => typeof p === 'string')) {
      out.plugins = obj.plugins as string[];
    }
    if (typeof obj.provider === 'string') out.provider = obj.provider;
    return out;
  });
}

export function loadState(): CodingAgentState {
  return loadJson(getStatePath(), (obj) => {
    const out: CodingAgentState = {};
    if (typeof obj.model === 'string') out.model = obj.model;
    if (typeof obj.thinkingVisible === 'boolean') out.thinkingVisible = obj.thinkingVisible;
    if (typeof obj.activeAgent === 'string') out.activeAgent = obj.activeAgent;
    return out;
  });
}

export function saveState(state: CodingAgentState): void {
  saveJson(getStatePath(), state);
}

export function saveConfig(config: CodingAgentConfig): void {
  saveJson(getConfigPath(), config);
}

const MAX_HISTORY = 500;

export function getHistoryPath(): string {
  return paths.historyFile;
}

function readHistoryRaw(): string[] {
  const path = getHistoryPath();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((e): e is string => typeof e === 'string');
  } catch {
    return [];
  }
}

export function loadHistory(): string[] {
  return readHistoryRaw().slice(-MAX_HISTORY);
}

export function appendHistory(entry: string): void {
  const history = readHistoryRaw();
  if (history[history.length - 1] === entry) return;
  history.push(entry);
  try {
    saveJson(getHistoryPath(), history);
  } catch { /* ignore */ }
}
