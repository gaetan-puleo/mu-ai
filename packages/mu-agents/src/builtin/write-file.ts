import { writeFileSync } from 'node:fs';
import type { PluginTool } from '../plugin';
import { sanitizePath } from './utils';

export function createWriteFileTool(getCwd: () => string): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
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
      },
    },
    display: {
      verb: 'writing',
      kind: 'file-write',
      fields: { path: 'path', content: 'content' },
    },
    execute(args) {
      const path = sanitizePath(args.path as string, getCwd());
      const content = args.content as string;
      try {
        writeFileSync(path, content, 'utf-8');
        return { content: `File written: ${path}` };
      } catch (err) {
        return { content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`, error: true };
      }
    },
  };
}
