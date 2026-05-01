import { watch } from 'node:fs';
import { extname, relative } from 'node:path';
import type { UIService } from 'mu-agents';
import { createLogger, type RepomapLogger } from './logger';
import { RepomapManager } from './manager';
import { SOURCE_EXTS } from './repomap';

export class RepomapWatcher {
  private watcher: ReturnType<typeof watch> | null = null;
  private manager: RepomapManager;
  private root: string;
  private logger: RepomapLogger;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChanges: Set<string> = new Set();
  private readonly DEBOUNCE_MS = 500;

  constructor(root: string, ui?: UIService) {
    this.root = root;
    this.manager = RepomapManager.getInstance(root);
    this.logger = createLogger(ui);
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
