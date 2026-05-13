import { newMessage, type Plugin, type Tool } from 'mu-core';
import { DEFAULT_PAGE_SIZE } from './listSymbols';
import type { UIService } from './logger';
import { RepomapManager } from './manager';
import { RepomapWatcher } from './watcher';

export interface RepomapOptions {
  /** Working directory accessor. Defaults to `process.cwd()`. */
  getCwd?: () => string;
  /** Optional UI service for status + notifications. */
  ui?: UIService;
  /** Default page size for `list_symbols`. */
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

function createListSymbolsTool(opts: RepomapOptions, getCwd: () => string): Tool {
  const defaultSize = opts.pageSize && opts.pageSize > 0 ? Math.floor(opts.pageSize) : DEFAULT_PAGE_SIZE;
  return {
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
    async execute(args) {
      const cwd = getCwd();
      const manager = RepomapManager.getInstance(cwd);
      const query = typeof args.query === 'string' ? args.query : '';
      const page = typeof args.page === 'number' ? args.page : 1;
      const pageSize = typeof args.pageSize === 'number' ? args.pageSize : defaultSize;
      const content = await manager.listSymbols({ query, page, pageSize });
      return { content, error: content.startsWith('Error:') };
    },
  };
}

export function createRepomapPlugin(options: RepomapOptions = {}): Plugin {
  let watcher: RepomapWatcher | null = null;
  const getCwd = options.getCwd ?? ((): string => process.cwd());
  const ui = options.ui;

  return {
    name: 'mu-repomap',
    register(api) {
      const cwd = getCwd();
      api.tool(createListSymbolsTool(options, getCwd));

      api.systemPrompt(async () => {
        const manager = RepomapManager.getInstance(cwd);
        const map = await manager.getMap();
        const guidance =
          'Use `list_symbols` to discover the codebase layer by layer (root dirs → directory → file → symbol). ' +
          'Always start broad and drill down — never request a deep layer blindly. ' +
          'Prefer this over bash grep/find for structural lookups.';
        if (!map) return guidance;
        return `${guidance}\nIndex ready: ${map.files.size} files indexed. Call list_symbols with no args for the top-level directories.`;
      });

      api.command({
        name: 'repomap',
        description: 'Show repomap status and stats',
        async execute(_args, session) {
          const manager = RepomapManager.getInstance(getCwd());
          const stats = await manager.getStats();
          await session.append(
            newMessage({ role: 'system', content: stats, meta: { visibility: 'ui', transient: true } }),
          );
        },
      });

      api.command({
        name: 'repomap:rebuild',
        description: 'Force rebuild the repomap index',
        async execute(_args, session) {
          const manager = RepomapManager.getInstance(getCwd());
          await manager.rebuild(true);
          await session.append(
            newMessage({
              role: 'system',
              content: 'Repomap rebuilt successfully',
              meta: { visibility: 'ui', transient: true },
            }),
          );
        },
      });

      const manager = RepomapManager.getInstance(cwd);
      manager.setUi(ui);

      manager.getMap().catch((err) => {
        ui?.notify(`Repomap build failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      });

      watcher = new RepomapWatcher(cwd);
      watcher.start();
    },
    deactivate() {
      watcher?.stop();
      watcher = null;
    },
  };
}
