import { extname, relative } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { RepomapLogger } from './logger';
import { RepomapManager } from './manager';
import { SOURCE_EXTS } from './repomap';

/**
 * Directories chokidar should never descend into. Recursive `fs.watch` used
 * to register inotify watches against every node_modules / .git / build
 * artefact in the tree, easily blowing past `fs.inotify.max_user_watches`
 * and crashing the host with an unhandled `'error'` event. Filtering at
 * registration time keeps the watch set bounded to actual source files.
 */
const IGNORED_GLOBS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.mu/**',
  '**/.cache/**',
  '**/.next/**',
  '**/.turbo/**',
];

export class RepomapWatcher {
  private watcher: FSWatcher | null = null;
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

    try {
      this.watcher = chokidar.watch(this.root, {
        // chokidar v5 accepts an array of matchers (glob strings, regexes,
        // or `(path, stats?) => boolean`). Critically: this list is consulted
        // *during* the initial recursive scan, so heavy directories like
        // `node_modules` are pruned before chokidar registers a single
        // inotify watch in them. Calling `watcher.unwatch(...)` post-hoc
        // would be too late — the scan would already have walked the tree.
        ignored: [
          ...IGNORED_GLOBS,
          (p, stats) => {
            // Only filter files by extension; let directories through so we
            // can descend into source trees the globs didn't already prune.
            // `stats` is undefined on early events — fall through to the
            // ext check (correct for files).
            if (stats?.isDirectory()) return false;
            const ext = extname(p).toLowerCase();
            return ext.length > 0 && !SOURCE_EXTS.has(ext);
          },
        ],
        ignoreInitial: true,
        persistent: true,
        // Avoid pnpm/workspace symlink loops blowing up the watch set.
        followSymlinks: false,
      });
    } catch (err) {
      // chokidar can throw synchronously on permission / unsupported FS
      // errors. Degrade gracefully: the index built at activation still
      // serves `list_symbols` queries; only live updates are disabled.
      this.logger.notify(
        `Watcher init failed (live updates disabled): ${err instanceof Error ? err.message : String(err)}`,
        'warning',
      );
      this.watcher = null;
      return;
    }

    this.watcher.on('add', (p) => this.handleChange(p));
    this.watcher.on('change', (p) => this.handleChange(p));
    this.watcher.on('unlink', (p) => this.handleChange(p));

    // CRITICAL: without this listener, an inotify ENOSPC / EMFILE / EACCES
    // becomes an `uncaughtException` and `app/shutdown.ts` exits the host
    // silently (the error scrolls away when the terminal is restored from
    // raw mode). Surface as a warning toast instead.
    this.watcher.on('error', (err) => {
      this.logger.notify(`Watcher error: ${err instanceof Error ? err.message : String(err)}`, 'warning');
    });

    // If the manager is replaced for a different root, stop watching here so
    // we don't leak fs handles or fire rebuilds on a disposed manager.
    this.unsubDispose = this.manager.onDispose(() => this.stop());
  }

  stop(): void {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
    if (this.unsubDispose) {
      this.unsubDispose();
      this.unsubDispose = null;
    }
  }

  private handleChange(fullPath: string): void {
    // Defensive double-check: chokidar's `ignored` callback covered ext, but
    // a path could still slip through during initial scan races.
    const ext = extname(fullPath).toLowerCase();
    if (!SOURCE_EXTS.has(ext)) return;

    const relPath = relative(this.root, fullPath);
    if (!relPath || relPath.startsWith('..')) return;

    this.pendingChanges.add(relPath);

    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
    }

    this.rebuildTimer = setTimeout(async () => {
      const changes = this.pendingChanges;
      this.pendingChanges = new Set();
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
