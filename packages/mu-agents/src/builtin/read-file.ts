import { existsSync, readFileSync } from 'node:fs';
import type { PluginTool } from '../plugin';
import { sanitizePath } from './utils';

function executeReadFileSingle(rawPath: string, start?: number, end?: number): string {
  const path = sanitizePath(rawPath);
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

export const readFileTool: PluginTool = {
  definition: {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read one or more files. When reading multiple files, pass an array of paths instead of separate calls. Always specify start/end line numbers when you can to minimize token consumption.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            oneOf: [
              { type: 'string', description: 'Absolute or relative file path' },
              {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of absolute or relative file paths',
              },
            ],
          },
          start: {
            type: 'integer',
            description: 'Start line number (1-indexed, inclusive). Omit to read from the beginning.',
          },
          end: { type: 'integer', description: 'End line number (1-indexed, inclusive). Omit to read to the end.' },
        },
        required: ['path'],
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

    if (paths.length === 1) {
      return executeReadFileSingle(paths[0], start, end);
    }

    const results: string[] = [];
    for (const path of paths) {
      results.push(executeReadFileSingle(path, start, end));
    }
    return results.join('\n\n');
  },
};
