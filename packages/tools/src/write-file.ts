import { existsSync } from 'node:fs';
import { type ContentPart, text, type Tool } from 'mu-core';
import { formatError, looksBinary, sanitizePath, validatedCwd, writeAtomic } from './utils';

import type { ToolFactoryOptions } from './types';

type WriteFileToolOptions = ToolFactoryOptions;

interface WriteFileArgs {
  path?: unknown;
  content?: unknown;
}

export function createWriteFileTool(opts: WriteFileToolOptions): Tool {
  const getCwd = validatedCwd(opts.getCwd);
  return {
    name: 'write',
    description:
      'Create or overwrite a file: use it only to create a new file or fully replace one. For partial changes to an existing file use `edit`.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    run(input): Promise<ContentPart[]> {
      const args = (input ?? {}) as WriteFileArgs;
      if (typeof args.path !== 'string') {
        return Promise.resolve([text('Error: write requires a string `path`')]);
      }
      if (typeof args.content !== 'string') {
        return Promise.resolve([text('Error: write requires a string `content`')]);
      }
      const path = sanitizePath(args.path, getCwd());
      const content = args.content;
      try {
        if (existsSync(path) && looksBinary(path)) {
          return Promise.resolve([text(`Error: Refusing to overwrite binary file: ${path}`)]);
        }
        writeAtomic(path, content);
        return Promise.resolve([text(`File written: ${path}`)]);
      } catch (err) {
        return Promise.resolve([text(formatError(err))]);
      }
    },
  };
}
