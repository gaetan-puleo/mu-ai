import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Tool } from 'mu-core';
import { sanitizePath } from './utils';

interface ListDirToolOptions {
  getCwd: () => string;
  restrictToCwd?: boolean;
}

function listDirRecursive(dir: string, prefix: string, depth: number, maxDepth: number, recursive: boolean): string {
  const entries = readdirSync(dir).sort();
  const lines: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === undefined) continue;
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    const icon = stat.isDirectory() ? '📁' : '📄';
    lines.push(`${prefix}${connector}${icon} ${entry}`);

    if (recursive && stat.isDirectory() && depth < maxDepth) {
      const extension = isLast ? '    ' : '│   ';
      lines.push(listDirRecursive(fullPath, prefix + extension, depth + 1, maxDepth, recursive));
    }
  }

  return lines.join('\n');
}

export function createListDirTool(opts: ListDirToolOptions): Tool {
  const { getCwd, restrictToCwd = false } = opts;
  return {
    name: 'list_dir',
    description: 'List the contents of a directory. Optionally recurse with a depth limit.',
    systemPrompt: 'Use `list_dir` to inspect directory contents (optionally recursive with `depth`).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list.' },
        recursive: { type: 'boolean', description: 'Recursively list subdirectories.' },
        depth: { type: 'integer', description: 'Max recursion depth (default: 2).' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    matchKey: (args) => (typeof args.path === 'string' ? args.path : undefined),
    formatArgs: (args) => {
      const path = typeof args.path === 'string' ? args.path : String(args.path ?? '');
      const suffix = args.recursive === true ? ' (recursive)' : '';
      const full = `${path}${suffix}`;
      return [{ label: 'path', value: full.length > 120 ? `${full.slice(0, 120)}…` : full }];
    },
    execute(args) {
      const rawPath = args.path as string;
      const cwd = getCwd();
      const path = sanitizePath(rawPath, cwd, restrictToCwd);
      if (path === null) {
        return { content: `Error: Invalid or disallowed path: ${rawPath}`, error: true };
      }
      if (!existsSync(path)) {
        return { content: `Error: Directory not found: ${path}`, error: true };
      }
      if (!statSync(path).isDirectory()) {
        return { content: `Error: Path is not a directory: ${path}`, error: true };
      }
      try {
        const recursive = (args.recursive as boolean) ?? false;
        const maxDepth = (args.depth as number) ?? 2;
        const lines = listDirRecursive(path, '', 0, maxDepth, recursive);
        return { content: lines || '(empty directory)' };
      } catch (err) {
        return {
          content: `Error listing directory: ${err instanceof Error ? err.message : String(err)}`,
          error: true,
        };
      }
    },
  };
}
