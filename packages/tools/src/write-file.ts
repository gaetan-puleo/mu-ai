import { existsSync } from 'node:fs';
import { formatError, type Tool } from 'mu-core';
import { looksBinary, sanitizePath, validatedCwd, writeAtomic } from './utils';

interface WriteFileToolOptions {
  getCwd: () => string;
  restrictToCwd?: boolean;
}

interface WriteFileArgs {
  path?: unknown;
  content?: unknown;
}

export function createWriteFileTool(opts: WriteFileToolOptions): Tool<WriteFileArgs, string> {
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
      if (typeof args.path !== 'string') {
        return 'Error: write requires a string `path`';
      }
      if (typeof args.content !== 'string') {
        return 'Error: write requires a string `content`';
      }
      const rawPath = args.path;
      const path = sanitizePath(rawPath, getCwd(), restrictToCwd);
      if (path === null) {
        return `Error: Invalid or disallowed path: ${rawPath}`;
      }
      const content = args.content;
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
