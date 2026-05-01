import { watch } from 'node:fs';
import { extname, relative } from 'node:path';
import type { RepomapLogger } from './logger';
import { RepomapManager } from './manager';
import { SOURCE_EXTS } from './repomap';

export class RepomapWatcher {
  private watcher: ReturnType<typeof watch> | null = null;
  private manager: RepomapManager;
  private root: string;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChanges: Set<string> = new Set();
  private unsubDispose: (() => void) | null = null;
  private readonly DEBOUNCE_MS = 500;

  constructor(root: string) {
    this.root = root;
    this.manager = RepomapManager.getInstance(root);
  }

  /**
   * Always pull the active logger from the manager so progress and errors
   * route through whatever UI was last attached via `manager.setUi(...)`.
   * If the constructor cached a logger, switching UIs (TUI mount, host
   * shutdown to console) would leave the watcher writing to a stale sink.
   */
  private get logger(): RepomapLogger {
    return this.manager.getLogger();
  }

  start(): void {
    if (this.watcher) return;

    this.watcher = watch(this.root, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;

      const filePath = typeof filename === 'string' ? filename : Buffer.from(filename).toString('utf-8');
      const fullPath = `${this.root}/${filePath}`;

      if (this.shouldIgnore(fullPath)) return;

      this.onFileChange(relative(this.root, fullPath));
    });

    // If the manager is replaced for a different root, stop watching here so
    // we don't leak fs.watch handles or fire rebuilds on a disposed manager.
    this.unsubDispose = this.manager.onDispose(() => this.stop());

    this.logger.notify('Watching for changes...', 'info');
  }

  stop(): void {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.unsubDispose) {
      this.unsubDispose();
      this.unsubDispose = null;
    }
  }

  private shouldIgnore(fullPath: string): boolean {
    const parts = fullPath.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i].startsWith('.') && parts[i] !== '.') return true;
    }
    const ext = extname(fullPath).toLowerCase();
    return !SOURCE_EXTS.has(ext);
  }

  private onFileChange(relPath: string): void {
    this.pendingChanges.add(relPath);

    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
    }

    this.rebuildTimer = setTimeout(async () => {
      const changes = this.pendingChanges;
      this.pendingChanges = new Set();
      if (changes.size > 0) {
        const files = Array.from(changes).join(', ');
        this.logger.notify(`Rebuilding (${changes.size} file(s)): ${files}`, 'info');
      }
      try {
        await this.manager.rebuild(changes.size > 0);
      } catch (err) {
        this.logger.notify(`Rebuild error: ${err instanceof Error ? err.message : err}`, 'error');
      } finally {
        this.rebuildTimer = null;
      }
    }, this.DEBOUNCE_MS);
  }
}
