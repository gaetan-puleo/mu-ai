import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Tool } from 'mu-core';
import { sanitizePath } from './utils';

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
    matchKey: (args) => (typeof args.path === 'string' ? args.path : undefined),
    execute(args) {
      const rawPath = args.path as string;
      const path = sanitizePath(rawPath, getCwd(), restrictToCwd);
      if (path === null) {
        return { content: `Error: Invalid or disallowed path: ${rawPath}`, error: true };
      }
      const content = args.content as string;
      try {
        // Auto-create missing parent directories — additive vs mu-coding's
        // historical behaviour; safe because it only triggers on missing dirs.
        const parentDir = dirname(path);
        if (!existsSync(parentDir)) {
          mkdirSync(parentDir, { recursive: true });
        }
        writeFileSync(path, content, 'utf-8');
        return { content: `File written: ${path}` };
      } catch (err) {
        return { content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`, error: true };
      }
    },
  };
}
