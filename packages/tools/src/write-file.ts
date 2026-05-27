import { existsSync } from 'node:fs';
import type { Tool } from 'mu-core';
import { formatError, looksBinary, parseArgs, sanitizePath, validatedCwd, writeAtomic } from './utils';

interface WriteFileToolOptions {
  getCwd: () => string;
  restrictToCwd?: boolean;
}

export function createWriteFileTool(opts: WriteFileToolOptions): Tool {
  const { restrictToCwd = false } = opts;
  const getCwd = validatedCwd(opts.getCwd);
  return {
    name: 'write',
    description: 'Create or overwrite a file. Use `edit` for partial changes to existing files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    execute(args) {
      const parsed = parseArgs(args);
      const rawPath = parsed.path as string;
      const path = sanitizePath(rawPath, getCwd(), restrictToCwd);
      if (path === null) {
        return `Error: Invalid or disallowed path: ${rawPath}`;
      }
      const content = parsed.content as string;
      try {
        // Refuse to overwrite an existing binary file: doing so silently turns
        // its bytes into UTF-8-encoded text and destroys the original.
        if (existsSync(path) && looksBinary(path)) {
          return `Error: Refusing to overwrite binary file: ${path}`;
        }
        writeAtomic(path, content);
        return `File written: ${path}`;
      } catch (err) {
        return formatError(err);
      }
    },
    onError: formatError,
  };
}
