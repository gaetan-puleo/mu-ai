import type { UIService } from 'mu-agents';
import { formatFileView, formatSummary, formatTree } from './formatter';
import { createLogger, type RepomapLogger } from './logger';
import { buildRepomap, findFile, findSymbol, type Repomap, type SymbolEntry } from './repomap';

export type RepomapState = 'idle' | 'building' | 'watching';

let instance: RepomapManager | null = null;

type StateListener = (state: RepomapState) => void;

export class RepomapManager {
  private map: Repomap | null = null;
  private root: string;
  private building = false;
  private logger: RepomapLogger = createLogger(undefined);
  private stateListeners: Set<StateListener> = new Set();

  constructor(root: string) {
    this.root = root;
  }

  static getInstance(root: string): RepomapManager {
    if (!instance || instance.root !== root) {
      instance = new RepomapManager(root);
    }
    return instance;
  }

  static reset(): void {
    instance = null;
  }

  /** Replace the logger. Call from `Plugin.activate` so progress goes through the host UI. */
  setUi(ui: UIService | undefined): void {
    this.logger = createLogger(ui);
  }

  /** Return the active logger so other components (watcher) share routing. */
  getLogger(): RepomapLogger {
    return this.logger;
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private emitState(): void {
    const state = this.getState();
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }

  getState(): RepomapState {
    if (this.building) return 'building';
    if (this.map) return 'watching';
    return 'idle';
  }

  async getMap(): Promise<Repomap | null> {
    if (this.map) return this.map;
    return this.build();
  }

  async build(): Promise<Repomap> {
    if (this.building) {
      while (this.building && this.map) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    if (this.map) return this.map;

    this.building = true;
    this.emitState();
    try {
      this.map = await buildRepomap(this.root, true, this.logger);
      return this.map;
    } finally {
      this.building = false;
      this.emitState();
    }
  }

  async rebuild(dirty = true): Promise<Repomap> {
    if (!dirty && this.map) {
      return this.map;
    }
    this.map = null;
    return this.build();
  }

  markDirty(): void {
    this.map = null;
  }

  // --- Query methods ---

  async findSymbol(name: string): Promise<SymbolEntry[]> {
    const map = await this.getMap();
    if (!map) return [];
    return findSymbol(map, name);
  }

  async findFile(pattern: string): Promise<ReturnType<typeof findFile>> {
    const map = await this.getMap();
    if (!map) return null;
    return findFile(map, pattern);
  }

  // --- Formatting ---

  async formatTree(opts?: { maxFiles?: number; maxRefs?: number }): Promise<string> {
    const map = await this.getMap();
    if (!map) return 'Repomap not available';
    return formatTree(map, opts);
  }

  async formatSummary(opts?: { maxFiles?: number }): Promise<string> {
    const map = await this.getMap();
    if (!map) return 'Repomap not available';
    return formatSummary(map, opts);
  }

  async formatFile(relPath: string): Promise<string> {
    const map = await this.getMap();
    if (!map) return 'Repomap not available';
    return formatFileView(map, relPath);
  }

  // --- Stats ---

  async getStats(): Promise<string> {
    const map = await this.getMap();
    if (!map) return 'Repomap not available';

    const elapsed = formatDuration(Date.now() - new Date(map.builtAt).getTime());
    return `${elapsed} ago`;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}
