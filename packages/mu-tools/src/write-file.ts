import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Tool } from 'mu-core';
import { formatError, parseArgs, sanitizePath } from './utils';

interface WriteFileToolOptions {
  getCwd: () => string;
  restrictToCwd?: boolean;
}

export function createWriteFileTool(opts: WriteFileToolOptions): Tool {
  const { getCwd, restrictToCwd = false } = opts;
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
        const parentDir = dirname(path);
        if (!existsSync(parentDir)) {
          mkdirSync(parentDir, { recursive: true });
        }
        writeFileSync(path, content, 'utf-8');
        return `File written: ${path}`;
      } catch (err) {
        return formatError(err);
      }
    },
    onError: formatError,
  };
}
