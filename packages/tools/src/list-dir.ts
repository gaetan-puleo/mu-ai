import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type ContentPart, text, type Tool } from 'mu-core';
import { formatError, sanitizePath, validatedCwd } from './utils';

import type { ToolFactoryOptions } from './types';

type ListDirToolOptions = ToolFactoryOptions;

interface ListDirArgs {
  path?: unknown;
  recursive?: unknown;
  depth?: unknown;
}

function listDirRecursive(dir: string, prefix: string, depth: number, maxDepth: number, recursive: boolean): string {
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return `${prefix}[permission denied]`;
  }
  const lines: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const fullPath = join(dir, entry);
    let isDir: boolean;
    let isSymlink: boolean;
    try {
      const st = lstatSync(fullPath);
      isSymlink = st.isSymbolicLink();
      isDir = isSymlink ? false : st.isDirectory();
    } catch {
      lines.push(`${prefix}${connector}⚠ ${entry}`);
      continue;
    }
    const icon = isSymlink ? '🔗' : isDir ? '📁' : '📄';
    lines.push(`${prefix}${connector}${icon} ${entry}`);

    if (recursive && isDir && !isSymlink && depth < maxDepth) {
      const extension = isLast ? '    ' : '│   ';
      lines.push(listDirRecursive(fullPath, prefix + extension, depth + 1, maxDepth, recursive));
    }
  }

  return lines.join('\n');
}

export function createListDirTool(opts: ListDirToolOptions): Tool {
  const getCwd = validatedCwd(opts.getCwd);
  return {
    name: 'list_dir',
    description: 'List the contents of a directory. Optionally recurse with a depth limit.',
    prompt:
      'Explore directories with `list_dir`. Reuse a listing already shown in the conversation instead of listing the same path again.',
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
    run(input): Promise<ContentPart[]> {
      const args = (input ?? {}) as ListDirArgs;
      if (typeof args.path !== 'string') {
        return Promise.resolve([text('Error: list_dir requires a string `path`')]);
      }
      const cwd = getCwd();
      const path = sanitizePath(args.path, cwd);
      if (!existsSync(path)) {
        return Promise.resolve([text(`Error: Directory not found: ${path}`)]);
      }
      if (!statSync(path).isDirectory()) {
        return Promise.resolve([text(`Error: Path is not a directory: ${path}`)]);
      }
      try {
        const recursive = typeof args.recursive === 'boolean' ? args.recursive : false;
        const maxDepth = typeof args.depth === 'number' ? args.depth : 2;
        const lines = listDirRecursive(path, '', 0, maxDepth, recursive);
        return Promise.resolve([text(lines || '(empty directory)')]);
      } catch (err) {
        return Promise.resolve([text(formatError(err))]);
      }
    },
  };
}
