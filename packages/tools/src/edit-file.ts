import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Tool } from 'mu-core';
import { formatError, parseArgs, sanitizePath } from './utils';

interface EditFileToolOptions {
  getCwd: () => string;
  restrictToCwd?: boolean;
}

export function createEditFileTool(opts: EditFileToolOptions): Tool {
  const { getCwd, restrictToCwd = false } = opts;
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
        writeFileSync(path, content.replace(oldString, newString), 'utf-8');
        return `File edited: ${path}`;
      } catch (err) {
        return formatError(err);
      }
    },
    onError: formatError,
  };
}
