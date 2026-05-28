import { existsSync } from 'node:fs';
import { formatError, type Tool } from 'mu-core';
import { looksBinary, readLineRange, sanitizePath, validatedCwd } from './utils';

interface ReadFileToolOptions {
  getCwd: () => string;
}

/** Wire-level shape declared in `parameters` below. Narrowed at the boundary. */
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

export function createReadFileTool(opts: ReadFileToolOptions): Tool<ReadFileArgs, string> {
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
      // Narrow at the boundary — finding #148 calls out the prior `as string`
      // cast pattern. Schema-as-types is best-effort; the runtime trusts but
      // verifies before doing work.
      const rawPath = args.path;
      const paths: string[] = Array.isArray(rawPath)
        ? rawPath.filter((p): p is string => typeof p === 'string')
        : typeof rawPath === 'string'
        ? [rawPath]
        : [];
      if (paths.length === 0) {
        return 'Error: read requires `path` (string or array of strings)';
      }
      const start = typeof args.start === 'number' ? args.start : undefined;
      const end = typeof args.end === 'number' ? args.end : undefined;
      const cwd = getCwd();

      return paths
        .map((p) => executeReadFileSingle(p, cwd, start, end))
        .join('\n\n');
    },
    onError: formatError,
  };
}
