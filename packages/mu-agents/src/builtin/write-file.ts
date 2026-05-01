import { writeFileSync } from 'node:fs';
import type { PluginTool } from '../plugin';
import { sanitizePath } from './utils';

export const writeFileTool: PluginTool = {
  definition: {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file, creating it if it does not exist or overwriting if it does.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative file path' },
          content: { type: 'string', description: 'The full content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  display: {
    verb: 'writing',
    kind: 'file-write',
    fields: { path: 'path', content: 'content' },
  },
  execute(args) {
    const path = sanitizePath(args.path as string);
    const content = args.content as string;
    try {
      writeFileSync(path, content, 'utf-8');
      return `File written: ${path}`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
    }
  },
};
