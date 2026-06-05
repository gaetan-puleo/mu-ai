import { existsSync } from 'node:fs';
import { type ContentPart, text, type Tool } from 'mu-core';
import { formatError, looksBinary, readLineRange, sanitizePath, validatedCwd } from './utils';

import type { ToolFactoryOptions } from './types';

type ReadFileToolOptions = ToolFactoryOptions;

interface ReadFileArgs {
  path?: unknown;
  start?: unknown;
  end?: unknown;
}

function executeReadFileSingle(
  rawPath: string,
  cwd: string,
  start?: number,
  end?: number,
): string {
  const path = sanitizePath(rawPath, cwd);
  if (!existsSync(path)) {
    return `Error: File not found: ${path}`;
  }
  try {
    if (looksBinary(path)) {
      return `Error: Refusing to read binary file: ${path}`;
    }

    const requestedStart = Math.max(1, start ?? 1);
    const requestedEnd = end ?? Number.MAX_SAFE_INTEGER;
    if (requestedStart > requestedEnd) {
      return `Error: start (${requestedStart}) > end (${requestedEnd})`;
    }

    const { lines, firstLine, lastLine, totalKnown, totalLines } = readLineRange(
      path,
      requestedStart,
      requestedEnd,
    );

    if (lines.length === 0) {
      const note = totalKnown ? ` (file has ${totalLines} lines)` : '';
      return `── ${path} ──\n(no lines in range ${requestedStart}-${
        requestedEnd === Number.MAX_SAFE_INTEGER ? 'end' : requestedEnd
      })${note}`;
    }

    const gutterWidth = String(lastLine).length;
    const numbered = lines
      .map((line, i) => `${String(firstLine + i).padStart(gutterWidth)} │ ${line}`)
      .join('\n');
    const rangeLabel = start ? ` (lines ${firstLine}-${lastLine})` : '';
    const header = `── ${path}${rangeLabel} (${lines.length} lines) ──`;
    return `${header}\n${numbered}`;
  } catch (err) {
    return formatError(err);
  }
}

export function createReadFileTool(opts: ReadFileToolOptions): Tool {
  const getCwd = validatedCwd(opts.getCwd);
  return {
    name: 'read',
    description:
      'Read text file(s) with line numbers; `path` may be a single path or array. Read before editing or quoting, and reuse a file already shown in the conversation instead of re-reading it.',
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
    run(input): Promise<ContentPart[]> {
      const args = (input ?? {}) as ReadFileArgs;
      try {
        const rawPath = args.path;
        const paths: string[] = Array.isArray(rawPath)
          ? rawPath.filter((p): p is string => typeof p === 'string')
          : typeof rawPath === 'string'
          ? [rawPath]
          : [];
        if (paths.length === 0) {
          return Promise.resolve([text('Error: read requires `path` (string or array of strings)')]);
        }
        const start = typeof args.start === 'number' ? args.start : undefined;
        const end = typeof args.end === 'number' ? args.end : undefined;
        const cwd = getCwd();

        const result = paths
          .map((p) => executeReadFileSingle(p, cwd, start, end))
          .join('\n\n');
        return Promise.resolve([text(result)]);
      } catch (err) {
        return Promise.resolve([text(formatError(err))]);
      }
    },
  };
}
