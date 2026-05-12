import { existsSync, readFileSync } from 'node:fs';
import type { PluginTool } from 'mu-core';
import { sanitizePath } from './utils';

interface ReadFileToolOptions {
  getCwd: () => string;
  restrictToCwd?: boolean;
}

function executeReadFileSingle(
  rawPath: string,
  cwd: string,
  restrictToCwd: boolean,
  start?: number,
  end?: number,
): string {
  const path = sanitizePath(rawPath, cwd, restrictToCwd);
  if (path === null) {
    return `Error: Invalid or disallowed path: ${rawPath}`;
  }
  if (!existsSync(path)) {
    return `Error: File not found: ${path}`;
  }
  try {
    const content = readFileSync(path, 'utf-8');
    const allLines = content.split('\n');
    const totalLines = allLines.length;

    const startLine = Math.max(1, start ?? 1);
    const endLine = end ?? totalLines;
    const clampedStart = Math.min(startLine, totalLines);
    const clampedEnd = Math.min(endLine, totalLines);

    if (clampedStart > clampedEnd) {
      return `Error: start (${startLine}) > end (${endLine})`;
    }

    const lines = allLines.slice(clampedStart - 1, clampedEnd);
    const numbered = lines.map((line, i) => `${String(clampedStart + i).padStart(4)} │ ${line}`).join('\n');
    const rangeLabel = start ? ` (lines ${clampedStart}-${clampedEnd})` : '';
    const header = `── ${path}${rangeLabel} (${lines.length} lines) ──`;
    return `${header}\n${numbered}`;
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

export function createReadFileTool(opts: ReadFileToolOptions): PluginTool {
  const { getCwd, restrictToCwd = false } = opts;
  return {
    definition: {
      type: 'function',
      function: {
        name: 'read',
        description: 'Read text file(s) with line numbers. `path` may be a single path or array.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: ['string', 'array'], items: { type: 'string' } },
            start: { type: 'integer', description: '1-indexed first line, inclusive.' },
            end: { type: 'integer', description: '1-indexed last line, inclusive.' },
          },
          required: ['path'],
          additionalProperties: false,
        },
      },
    },
    display: {
      verb: 'reading',
      kind: 'file-read',
      fields: { path: 'path', start: 'start', end: 'end' },
    },
    permission: {
      matchKey: (args) => {
        const p = args.path;
        if (typeof p === 'string') return p;
        if (Array.isArray(p)) return p[0] as string | undefined;
        return undefined;
      },
    },
    execute(args) {
      const paths = Array.isArray(args.path) ? (args.path as string[]) : [args.path as string];
      const start = args.start as number | undefined;
      const end = args.end as number | undefined;
      const cwd = getCwd();

      if (paths.length === 1) {
        const content = executeReadFileSingle(paths[0], cwd, restrictToCwd, start, end);
        return { content, error: content.startsWith('Error:') };
      }

      const results: string[] = [];
      let anyError = false;
      for (const path of paths) {
        const content = executeReadFileSingle(path, cwd, restrictToCwd, start, end);
        if (content.startsWith('Error:')) anyError = true;
        results.push(content);
      }
      return { content: results.join('\n\n'), error: anyError };
    },
  };
}
