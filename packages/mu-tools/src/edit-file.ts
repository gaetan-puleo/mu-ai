import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Tool, ToolResult } from 'mu-core';
import { sanitizePath } from './utils';

interface EditFileToolOptions {
  getCwd: () => string;
  restrictToCwd?: boolean;
}

export function createEditFileTool(opts: EditFileToolOptions): Tool {
  const { getCwd, restrictToCwd = false } = opts;
  return {
    name: 'edit',
    description: 'Replace an exact substring in an existing file.',
    systemPrompt:
      'Use `edit` for surgical changes; include enough context in `from` to be unique. One `edit` call per change site.',
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
    matchKey: (args) => (typeof args.path === 'string' ? args.path : undefined),
    formatArgs: (args) => {
      const path = typeof args.path === 'string' ? args.path : String(args.path ?? '');
      const from = typeof args.from === 'string' ? args.from : String(args.from ?? '');
      const to = typeof args.to === 'string' ? args.to : String(args.to ?? '');
      const t = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);
      return [
        { label: 'path', value: t(path, 120) },
        { label: 'from', value: t(from, 80) },
        { label: 'to', value: t(to, 80) },
      ];
    },
    execute(args): ToolResult {
      const rawPath = args.path as string;
      const path = sanitizePath(rawPath, getCwd(), restrictToCwd);
      if (path === null) {
        return { content: `Error: Invalid or disallowed path: ${rawPath}`, error: true };
      }
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
