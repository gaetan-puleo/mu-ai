import { existsSync } from 'node:fs';
import { formatError, parseArgs, type Tool } from 'mu-core';
import { looksBinary, readLineRange, sanitizePath, validatedCwd } from './utils';

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
    if (looksBinary(path)) {
      return `Error: Refusing to read binary file: ${path}`;
    }

    // Stream the requested range only; never load the whole file into memory.
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
  const { restrictToCwd = false } = opts;
  const getCwd = validatedCwd(opts.getCwd);
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

      return paths
        .map((p) => executeReadFileSingle(p, cwd, restrictToCwd, start, end))
        .join('\n\n');
    },
    onError: formatError,
  };
}
