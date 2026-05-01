import type { Plugin, PluginTool, StatusSegment, UIService } from 'mu-agents';
import { formatSummary } from './formatter';
import { RepomapManager } from './manager';
import type { SymbolEntry } from './repomap';
import { RepomapWatcher } from './watcher';

export interface RepomapOptions {
  maxFiles?: number;
  maxRefs?: number;
}

function createSearchCodeTool(opts: RepomapOptions, getCwd: () => string): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'search_code',
        description:
          'Search project code. Use repomap mode for fast index-based queries (list all functions, find a symbol). Examples: query="useState", query="fn", query="all", query="file:src/utils/p-limit.ts"',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Repomap query: symbol name (e.g. "useState"), kind (e.g. "fn", "class"), "all" for summary, or file path',
            },
          },
          required: [],
          additionalProperties: false,
        },
      },
    },
    display: {
      verb: 'searching',
      kind: 'search',
      fields: { query: 'query' },
    },
    async execute(args) {
      const query = (args.query as string) ?? '';
      const cwd = getCwd();
      const manager = RepomapManager.getInstance(cwd);

      if (!query) return await manager.formatTree({ maxFiles: opts.maxFiles ?? 40, maxRefs: opts.maxRefs ?? 10 });
      if (query === 'summary') return await manager.formatSummary({ maxFiles: opts.maxFiles ?? 80 });
      if (query === 'stats') return await manager.getStats();
      if (query === 'tree')
        return await manager.formatTree({ maxFiles: opts.maxFiles ?? 40, maxRefs: opts.maxRefs ?? 10 });
      if (query.includes('/') || query.includes('\\')) return await manager.formatFile(query);

      const syms = await manager.findSymbol(query);
      if (syms.length === 0) return `Symbol not found: ${query}`;

      return formatSymbolResults(query, syms, cwd);
    },
  };
}

function groupSymsByFile(syms: SymbolEntry[], cwd: string): Map<string, SymbolEntry[]> {
  const byFile = new Map<string, SymbolEntry[]>();
  for (const s of syms) {
    const relFile = s.file.replace(`${cwd}/`, '');
    const group = byFile.get(relFile);
    if (group) {
      group.push(s);
    } else {
      byFile.set(relFile, [s]);
    }
  }
  return byFile;
}

function formatSymbolRefs(sym: SymbolEntry, cwd: string): string[] {
  const parts: string[] = [];
  if (sym.references.length === 0) return parts;

  parts.push('    refs:');
  const refsByFile = new Map<string, number[]>();
  for (const ref of sym.references) {
    const refFile = ref.file.replace(`${cwd}/`, '');
    const group = refsByFile.get(refFile);
    if (group) {
      group.push(ref.line);
    } else {
      refsByFile.set(refFile, [ref.line]);
    }
  }
  for (const [refFile, refLines] of refsByFile) {
    const sorted = refLines.sort((a, b) => a - b);
    const rangeHint =
      sorted.length > 1 ? ` read_file ${refFile} start:${sorted[0]} end:${sorted[sorted.length - 1]}` : '';
    parts.push(`      ${refFile}:${sorted.join(', ')}${rangeHint}`);
  }
  return parts;
}

function formatSymbolResults(query: string, syms: SymbolEntry[], cwd: string): string {
  const parts: string[] = [];

  parts.push(`"${query}" — ${syms.length} occurrence(s)`);
  parts.push('');

  const byFile = groupSymsByFile(syms, cwd);

  for (const [file, fileSyms] of byFile) {
    parts.push(`## ${file}`);
    parts.push(`  read_file ${file} start:${fileSyms[0].line} end:${fileSyms[fileSyms.length - 1].line + 5}`);
    parts.push('');

    for (const sym of fileSyms) {
      const kindLabel = sym.export ? 'export' : 'internal';
      parts.push(`  ${sym.kind} ${sym.name} at line ${sym.line} (${kindLabel})`);
      parts.push(...formatSymbolRefs(sym, cwd));
      parts.push('');
    }
  }

  return parts.join('\n');
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
    version: '0.1.0',

    tools: [createSearchCodeTool(opts, getCwd)],

    systemPrompt: async (ctx) => {
      const manager = RepomapManager.getInstance(ctx.cwd);
      const map = await manager.getMap();
      if (!map) return '';
      return formatSummary(map, { maxFiles: opts.maxFiles ?? 80 });
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

    async activate(ctx) {
      pluginCwd = ctx.cwd;
      pluginUi = ctx.ui;
      setStatusLine = ctx.setStatusLine;

      pushStatus('idle');
      const manager = RepomapManager.getInstance(ctx.cwd);
      manager.setUi(pluginUi);
      manager.onStateChange(pushStatus);
      await manager.getMap();
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
