import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { PluginTool } from '../plugin';
import { sanitizePath } from './utils';

export const editFileTool: PluginTool = {
  definition: {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Replace an exact string in a file with a new string. Fails if the old string is not found or appears more than once.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative file path' },
          old_string: { type: 'string', description: 'The exact string to find and replace' },
          new_string: { type: 'string', description: 'The replacement string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  display: {
    verb: 'editing',
    kind: 'diff',
    fields: { path: 'path', from: 'old_string', to: 'new_string' },
  },
  execute(args) {
    const path = sanitizePath(args.path as string);
    const oldString = args.old_string as string;
    const newString = args.new_string as string;

    if (!existsSync(path)) {
      return `Error: File not found: ${path}`;
    }
    try {
      const content = readFileSync(path, 'utf-8');
      const count = content.split(oldString).length - 1;
      if (count === 0) {
        return 'Error: old_string not found in file';
      }
      if (count > 1) {
        return `Error: old_string found ${count} times, must be unique`;
      }
      writeFileSync(path, content.replace(oldString, newString), 'utf-8');
      return `File edited: ${path}`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
    }
  },
};
