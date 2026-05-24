import { existsSync, readFileSync } from 'node:fs';
import type { Tool } from 'mu-core';
import { formatError, parseArgs, sanitizePath } from './utils';

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

    const clampedStart = Math.max(1, Math.min(start ?? 1, totalLines));
    const clampedEnd = Math.min(end ?? totalLines, totalLines);

    if (clampedStart > clampedEnd) {
      return `Error: start (${clampedStart}) > end (${clampedEnd})`;
    }

    const lines = allLines.slice(clampedStart - 1, clampedEnd);
    const gutterWidth = String(clampedEnd).length;
    const numbered = lines.map((line, i) => `${String(clampedStart + i).padStart(gutterWidth)} │ ${line}`).join('\n');
    const rangeLabel = start ? ` (lines ${clampedStart}-${clampedEnd})` : '';
    const header = `── ${path}${rangeLabel} (${lines.length} lines) ──`;
    return `${header}\n${numbered}`;
  } catch (err) {
    return formatError(err);
  }
}

export function createReadFileTool(opts: ReadFileToolOptions): Tool {
  const { getCwd, restrictToCwd = false } = opts;
  return {
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
    execute(args) {
      const parsed = parseArgs(args);
      const rawPath = parsed.path;
      const paths = Array.isArray(rawPath) ? (rawPath as string[]) : [rawPath as string];
      const start = parsed.start as number | undefined;
      const end = parsed.end as number | undefined;
      const cwd = getCwd();

      if (paths.length === 1) {
        return executeReadFileSingle(paths[0], cwd, restrictToCwd, start, end);
      }

      const results: string[] = [];
      for (const p of paths) {
        results.push(executeReadFileSingle(p, cwd, restrictToCwd, start, end));
      }
      return results.join('\n\n');
    },
    onError: formatError,
  };
}
