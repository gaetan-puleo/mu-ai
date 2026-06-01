import { existsSync, readFileSync } from 'node:fs';
import { type ContentPart, text, type Tool } from 'mu-core';
import { formatError, looksBinary, sanitizePath, validatedCwd, writeAtomic } from './utils';

import type { ToolFactoryOptions } from './types';

type EditFileToolOptions = ToolFactoryOptions;

interface EditFileArgs {
  path?: unknown;
  from?: unknown;
  to?: unknown;
}

export function createEditFileTool(opts: EditFileToolOptions): Tool {
  const getCwd = validatedCwd(opts.getCwd);
  return {
    name: 'edit',
    description:
      'Replace an exact substring in an existing file. `from` must occur exactly once — include surrounding context to disambiguate. Whitespace must match exactly.',
    prompt: 'Prefer `edit` over `write` for changes to existing files; `from` must match exactly and occur once.',
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
    run(input): Promise<ContentPart[]> {
      const args = (input ?? {}) as EditFileArgs;
      if (typeof args.path !== 'string') {
        return Promise.resolve([text('Error: edit requires a string `path`')]);
      }
      if (typeof args.from !== 'string') {
        return Promise.resolve([text('Error: edit requires a string `from`')]);
      }
      if (typeof args.to !== 'string') {
        return Promise.resolve([text('Error: edit requires a string `to`')]);
      }
      const path = sanitizePath(args.path, getCwd());
      const oldString = args.from;
      const newString = args.to;

      if (!existsSync(path)) {
        return Promise.resolve([text(`Error: File not found: ${path}`)]);
      }
      try {
        if (looksBinary(path)) {
          return Promise.resolve([text(`Error: Refusing to edit binary file: ${path}`)]);
        }
        const content = readFileSync(path, 'utf-8');
        let count = 0;
        let searchFrom = 0;
        while (count < 2) {
          const idx = content.indexOf(oldString, searchFrom);
          if (idx === -1) break;
          count++;
          searchFrom = idx + oldString.length;
        }
        if (count === 0) {
          return Promise.resolve([text('Error: "from" not found in file')]);
        }
        if (count > 1) {
          return Promise.resolve([text('Error: "from" found multiple times, must be unique')]);
        }
        writeAtomic(path, content.replace(oldString, newString));
        return Promise.resolve([text(`File edited: ${path}`)]);
      } catch (err) {
        return Promise.resolve([text(formatError(err))]);
      }
    },
  };
}
