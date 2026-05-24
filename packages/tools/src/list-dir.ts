import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Tool } from 'mu-core';
import { formatError, parseArgs, sanitizePath } from './utils';

interface ListDirToolOptions {
  getCwd: () => string;
  restrictToCwd?: boolean;
}

function listDirRecursive(dir: string, prefix: string, depth: number, maxDepth: number, recursive: boolean): string {
  const entries = readdirSync(dir).sort();
  const lines: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const fullPath = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(fullPath).isDirectory();
    } catch {
      lines.push(`${prefix}${connector}⚠ ${entry}`);
      continue;
    }
    const icon = isDir ? '📁' : '📄';
    lines.push(`${prefix}${connector}${icon} ${entry}`);

    if (recursive && isDir && depth < maxDepth) {
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
    execute(args) {
      const parsed = parseArgs(args);
      const rawPath = parsed.path as string;
      const cwd = getCwd();
      const path = sanitizePath(rawPath, cwd, restrictToCwd);
      if (path === null) {
        return `Error: Invalid or disallowed path: ${rawPath}`;
      }
      if (!existsSync(path)) {
        return `Error: Directory not found: ${path}`;
      }
      if (!statSync(path).isDirectory()) {
        return `Error: Path is not a directory: ${path}`;
      }
      try {
        const recursive = (parsed.recursive as boolean) ?? false;
        const maxDepth = (parsed.depth as number) ?? 2;
        const lines = listDirRecursive(path, '', 0, maxDepth, recursive);
        return lines || '(empty directory)';
      } catch (err) {
        return formatError(err);
      }
    },
    onError: formatError,
  };
}
