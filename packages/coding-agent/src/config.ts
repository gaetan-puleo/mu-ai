import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface CodingAgentConfig {
  kind?: string;
  baseUrl?: string;
}

export interface CodingAgentState {
  model?: string;
  thinkingVisible?: boolean;
}

export function getConfigPath(): string {
  const dir = process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, 'mu') : join(homedir(), '.config', 'mu');
  return join(dir, 'config.json');
}

export function getStatePath(): string {
  const dir = process.env.XDG_STATE_HOME
    ? join(process.env.XDG_STATE_HOME, 'mu')
    : join(homedir(), '.local', 'state', 'mu');
  return join(dir, 'state.json');
}

export function loadConfig(): CodingAgentConfig {
  const path = getConfigPath();
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const obj = raw as Record<string, unknown>;
    const out: CodingAgentConfig = {};
    if (typeof obj.kind === 'string') out.kind = obj.kind;
    if (typeof obj.baseUrl === 'string') out.baseUrl = obj.baseUrl;
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[coding-agent] failed to parse ${path}: ${msg}\n`);
    return {};
  }
}

export function loadState(): CodingAgentState {
  const path = getStatePath();
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const obj = raw as Record<string, unknown>;
    const out: CodingAgentState = {};
    if (typeof obj.model === 'string') out.model = obj.model;
    if (typeof obj.thinkingVisible === 'boolean') out.thinkingVisible = obj.thinkingVisible;
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[coding-agent] failed to parse ${path}: ${msg}\n`);
    return {};
  }
}

export function saveState(state: CodingAgentState): void {
  const path = getStatePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}
