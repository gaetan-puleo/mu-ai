import { existsSync, readFileSync } from 'node:fs';
import type { PluginTool } from '../plugin';
import { sanitizePath } from './utils';

function executeReadFileSingle(rawPath: string, cwd: string, start?: number, end?: number): string {
  const path = sanitizePath(rawPath, cwd);
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

export function createReadFileTool(getCwd: () => string): PluginTool {
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
    execute(args) {
      const paths = Array.isArray(args.path) ? (args.path as string[]) : [args.path as string];
      const start = args.start as number | undefined;
      const end = args.end as number | undefined;
      const cwd = getCwd();

      if (paths.length === 1) {
        return executeReadFileSingle(paths[0], cwd, start, end);
      }

      const results: string[] = [];
      for (const path of paths) {
        results.push(executeReadFileSingle(path, cwd, start, end));
      }
      return results.join('\n\n');
    },
  };
}
