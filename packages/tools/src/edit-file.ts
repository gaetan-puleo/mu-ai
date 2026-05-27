import { existsSync, readFileSync } from 'node:fs';
import { formatError, parseArgs, type Tool } from 'mu-core';
import { looksBinary, sanitizePath, validatedCwd, writeAtomic } from './utils';

interface EditFileToolOptions {
  getCwd: () => string;
  restrictToCwd?: boolean;
}

export function createEditFileTool(opts: EditFileToolOptions): Tool {
  const { restrictToCwd = false } = opts;
  const getCwd = validatedCwd(opts.getCwd);
  return {
    name: 'edit',
    description:
      'Replace an exact substring in an existing file. `from` must occur exactly once — include surrounding context to disambiguate. Whitespace must match exactly.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        from: {
          type: 'string',
          description:
            'Must occur exactly once in the file — include surrounding context to disambiguate. Whitespace must match exactly.',
        },
        to: { type: 'string' },
      },
      required: ['path', 'from', 'to'],
      additionalProperties: false,
    },
    execute(args) {
      const parsed = parseArgs(args);
      const rawPath = parsed.path as string;
      const path = sanitizePath(rawPath, getCwd(), restrictToCwd);
      if (path === null) {
        return `Error: Invalid or disallowed path: ${rawPath}`;
      }
      const oldString = parsed.from as string;
      const newString = parsed.to as string;

      if (!existsSync(path)) {
        return `Error: File not found: ${path}`;
      }
      try {
        if (looksBinary(path)) {
          return `Error: Refusing to edit binary file: ${path}`;
        }
        const content = readFileSync(path, 'utf-8');
        // Count occurrences without materializing N+1 substrings; bail at 2.
        let count = 0;
        let searchFrom = 0;
        while (count < 2) {
          const idx = content.indexOf(oldString, searchFrom);
          if (idx === -1) break;
          count++;
          searchFrom = idx + oldString.length;
        }
        if (count === 0) {
          return 'Error: "from" not found in file';
        }
        if (count > 1) {
          return 'Error: "from" found multiple times, must be unique';
        }
        // Atomic temp+rename: readers either see the old or new contents, never a partial file.
        // Note: TOCTOU is still possible between the read above and the rename below — a concurrent
        // writer could clobber our edit, or be clobbered by it. Atomic write at least guarantees
        // no torn writes on crash.
        writeAtomic(path, content.replace(oldString, newString));
        return `File edited: ${path}`;
      } catch (err) {
        return formatError(err);
      }
    },
    onError: formatError,
  };
}
