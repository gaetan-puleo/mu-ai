import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { PluginTool, ToolExecutorResult } from '../plugin';
import { sanitizePath } from './utils';

export function createEditFileTool(getCwd: () => string): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'edit',
        description: 'Replace an exact substring in an existing file.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            from: {
              type: 'string',
              description:
                'Must occur exactly once in the file \u2014 include surrounding context to disambiguate. Whitespace must match exactly.',
            },
            to: { type: 'string' },
          },
          required: ['path', 'from', 'to'],
          additionalProperties: false,
        },
      },
    },
    display: {
      verb: 'editing',
      kind: 'diff',
      fields: { path: 'path', from: 'from', to: 'to' },
    },
    execute(args): ToolExecutorResult {
      const path = sanitizePath(args.path as string, getCwd());
      const oldString = args.from as string;
      const newString = args.to as string;

      if (!existsSync(path)) {
        return { content: `Error: File not found: ${path}`, error: true };
      }
      try {
        const content = readFileSync(path, 'utf-8');
        const count = content.split(oldString).length - 1;
        if (count === 0) {
          return { content: 'Error: "from" not found in file', error: true };
        }
        if (count > 1) {
          return { content: `Error: "from" found ${count} times, must be unique`, error: true };
        }
        writeFileSync(path, content.replace(oldString, newString), 'utf-8');
        return { content: `File edited: ${path}` };
      } catch (err) {
        return { content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`, error: true };
      }
    },
  };
}
