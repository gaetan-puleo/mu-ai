import { createHistoryStore, createJsonStore, createXdgPaths } from 'mu-harness';

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

const configStore = createJsonStore<CodingAgentConfig>({
  path: paths.configFile,
  onParseError: (path, err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[coding-agent] failed to parse ${path}: ${msg}\n`);
  },
  validate: (obj) => {
    const out: CodingAgentConfig = {};
    if (typeof obj.kind === 'string') out.kind = obj.kind;
    if (typeof obj.baseUrl === 'string') out.baseUrl = obj.baseUrl;
    if (Array.isArray(obj.plugins) && obj.plugins.every((p) => typeof p === 'string')) {
      out.plugins = obj.plugins as string[];
    }
    if (typeof obj.provider === 'string') out.provider = obj.provider;
    return out;
  },
});

const stateStore = createJsonStore<CodingAgentState>({
  path: paths.stateFile,
  onParseError: (path, err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[coding-agent] failed to parse ${path}: ${msg}\n`);
  },
  validate: (obj) => {
    const out: CodingAgentState = {};
    if (typeof obj.model === 'string') out.model = obj.model;
    if (typeof obj.thinkingVisible === 'boolean') out.thinkingVisible = obj.thinkingVisible;
    if (typeof obj.activeAgent === 'string') out.activeAgent = obj.activeAgent;
    return out;
  },
});

const historyStore = createHistoryStore({ path: paths.historyFile });

export function getConfigPath(): string {
  return paths.configFile;
}

export function loadConfig(): CodingAgentConfig {
  return configStore.load();
}

export function saveConfig(config: CodingAgentConfig): void {
  configStore.save(config);
}

export function loadState(): CodingAgentState {
  return stateStore.load();
}

export function saveState(state: CodingAgentState): void {
  stateStore.save(state);
}

export function loadHistory(): string[] {
  return historyStore.load();
}

export function appendHistory(entry: string): void {
  historyStore.append(entry);
}
