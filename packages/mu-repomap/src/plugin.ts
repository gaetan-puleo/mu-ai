import type { Plugin, PluginTool, StatusSegment, UIService } from 'mu-core';
import { DEFAULT_PAGE_SIZE } from './listSymbols';
import { RepomapManager } from './manager';
import { RepomapWatcher } from './watcher';

export interface RepomapOptions {
  /** Default page size for `list_symbols`. Overridable per-call via the `pageSize` arg. */
  pageSize?: number;
}

const TOOL_DESCRIPTION =
  'List project symbols layer by layer. You MUST descend progressively to avoid context overflow:\n' +
  '  1. Start with no query → returns top-level directories.\n' +
  '  2. Pick one with `dir:<path>` → returns its files and immediate subdirs.\n' +
  '  3. Pick a file with `file:<path>` → returns its exports.\n' +
  '  4. Pick a symbol with `sym:<name>` (or `sym:<name>@<file>` to disambiguate) → returns definition + refs.\n' +
  'NEVER skip layers. Each call returns ≤ pageSize entries (default 20). Use `page:N` for the next slice; ' +
  '`pageSize:N` to override only when the layer is small.';

function createListSymbolsTool(opts: RepomapOptions, getCwd: () => string): PluginTool {
  const defaultSize = opts.pageSize && opts.pageSize > 0 ? Math.floor(opts.pageSize) : DEFAULT_PAGE_SIZE;
  return {
    definition: {
      type: 'function',
      function: {
        name: 'list_symbols',
        description: TOOL_DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '"" (root dirs) | dir:<path> | file:<path> | sym:<name>[@<file>]',
            },
            page: {
              type: 'integer',
              minimum: 1,
              default: 1,
              description: '1-indexed page number for paginated layers.',
            },
            pageSize: {
              type: 'integer',
              minimum: 1,
              default: defaultSize,
              description: `Override default page size (${defaultSize}). Increase only when the layer is small.`,
            },
          },
          required: [],
          additionalProperties: false,
        },
      },
    },
    display: {
      verb: 'listing',
      kind: 'search',
      fields: { query: 'query' },
    },
    async execute(args) {
      const cwd = getCwd();
      const manager = RepomapManager.getInstance(cwd);
      const query = typeof args.query === 'string' ? args.query : '';
      const page = typeof args.page === 'number' ? args.page : 1;
      const pageSize = typeof args.pageSize === 'number' ? args.pageSize : defaultSize;
      return await manager.listSymbols({ query, page, pageSize });
    },
  };
}

export function createRepomapPlugin(options?: RepomapOptions): Plugin {
  let watcher: RepomapWatcher | null = null;
  let pluginCwd: string | null = null;
  let pluginUi: UIService | undefined;
  let setStatusLine: ((segments: StatusSegment[]) => void) | undefined;
  const opts = options ?? {};

  // Capture cwd at activation time so the tool always uses the host-supplied
  // value, never `process.cwd()` (which can drift if the agent runs elsewhere).
  const getCwd = (): string => {
    if (!pluginCwd) {
      throw new Error('mu-repomap plugin not activated yet');
    }
    return pluginCwd;
  };

  const pushStatus = (state: 'idle' | 'building' | 'watching') => {
    if (!setStatusLine) return;
    if (state === 'building') {
      setStatusLine([{ text: '⟳ indexing', color: 'yellow' }]);
    } else if (state === 'watching') {
      setStatusLine([{ text: '● indexed', color: 'green' }]);
    } else {
      setStatusLine([{ text: '○ repomap', dim: true }]);
    }
  };

  return {
    name: 'mu-repomap',
    version: '0.2.0',

    tools: [createListSymbolsTool(opts, getCwd)],

    systemPrompt: async (ctx) => {
      const manager = RepomapManager.getInstance(ctx.cwd);
      const map = await manager.getMap();
      const guidance =
        'Use `list_symbols` to discover the codebase layer by layer (root dirs → directory → file → symbol). ' +
        'Always start broad and drill down — never request a deep layer blindly. ' +
        'Prefer this over bash grep/find for structural lookups.';
      if (!map) return guidance;
      return `${guidance}\nIndex ready: ${map.files.size} files indexed. Call list_symbols with no args for the top-level directories.`;
    },

    commands: [
      {
        name: 'repomap',
        description: 'Show repomap status and stats',
        async execute(_args, ctx) {
          const manager = RepomapManager.getInstance(ctx.cwd);
          return await manager.getStats();
        },
      },
      {
        name: 'repomap:rebuild',
        description: 'Force rebuild the repomap index',
        async execute(_args, ctx) {
          const manager = RepomapManager.getInstance(ctx.cwd);
          await manager.rebuild(true);
          return 'Repomap rebuilt successfully';
        },
      },
    ],

    activate(ctx) {
      pluginCwd = ctx.cwd;
      pluginUi = ctx.ui;
      setStatusLine = ctx.setStatusLine;

      pushStatus('idle');
      const manager = RepomapManager.getInstance(ctx.cwd);
      manager.setUi(pluginUi);
      manager.onStateChange(pushStatus);

      // Build the index in the background so the host's startup isn't
      // blocked by an ast-grep cold scan. State transitions (idle →
      // building → watching) flow through `pushStatus`, and any failure
      // surfaces as a toast via the manager's logger.
      manager.getMap().catch((err) => {
        pluginUi?.notify(`Repomap build failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      });

      // Watcher reads its logger from the manager — no need to pass `ui`
      // separately, which kept logger routing in sync if the host swapped UIs.
      watcher = new RepomapWatcher(ctx.cwd);
      watcher.start();
    },

    deactivate() {
      watcher?.stop();
      watcher = null;
      pluginCwd = null;
      pluginUi = undefined;
      setStatusLine = undefined;
    },
  };
}
