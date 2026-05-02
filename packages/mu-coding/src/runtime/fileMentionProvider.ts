import { execFileSync } from 'node:child_process';
import { type Dirent, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { MentionCompletion, MentionProvider } from 'mu-core';

const CACHE_TTL_MS = 5_000;
const MAX_FILES = 5_000;
const MAX_RESULTS = 12;
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.turbo', 'coverage']);

interface FileCache {
  files: string[];
  builtAt: number;
}

let cache: FileCache | null = null;
let cacheCwd = '';

function listGitFiles(cwd: string): string[] | null {
  try {
    const stdout = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const files = stdout.split('\n').filter((line) => line.length > 0);
    return files.slice(0, MAX_FILES);
  } catch {
    return null;
  }
}

function walkFs(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < MAX_FILES) {
    const dir = stack.pop();
    if (!dir) break;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      if (IGNORE_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        out.push(relative(root, full).split(sep).join('/'));
        if (out.length >= MAX_FILES) break;
      }
    }
  }
  return out;
}

function refreshCache(cwd: string): string[] {
  if (cache && cacheCwd === cwd && Date.now() - cache.builtAt < CACHE_TTL_MS) {
    return cache.files;
  }
  const files = listGitFiles(cwd) ?? walkFs(cwd);
  cache = { files, builtAt: Date.now() };
  cacheCwd = cwd;
  return files;
}

/**
 * Score a file path against `partial` for ranking.
 *  - exact basename match → 0 (best)
 *  - basename starts with partial → 1
 *  - basename contains partial → 2
 *  - path contains partial → 3
 *  - otherwise → Infinity (filtered out)
 */
function scorePath(path: string, partial: string): number {
  if (!partial) return path.length; // empty partial → shorter paths first
  const lower = path.toLowerCase();
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  const p = partial.toLowerCase();
  if (base === p) return 0;
  if (base.startsWith(p)) return 1;
  if (base.includes(p)) return 2;
  if (lower.includes(p)) return 3;
  return Number.POSITIVE_INFINITY;
}

/**
 * Build the file mention provider bound to `cwd`. Suggests up to
 * `MAX_RESULTS` files matched against the partial, ranked by basename
 * proximity. Cached for {@link CACHE_TTL_MS} so rapid keystrokes don't
 * re-walk the tree.
 */
export function createFileMentionProvider(cwd: string): MentionProvider {
  return (partial: string): MentionCompletion[] => {
    const files = refreshCache(cwd);
    if (files.length === 0) return [];
    const scored: { path: string; score: number }[] = [];
    for (const f of files) {
      const score = scorePath(f, partial);
      if (score < Number.POSITIVE_INFINITY) scored.push({ path: f, score });
    }
    scored.sort((a, b) => a.score - b.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
    return scored.slice(0, MAX_RESULTS).map(({ path }) => ({
      value: path,
      // Show the full path so the basename sits at the end of the line —
      // the picker truncates the prefix when needed (`wrap="truncate-start"`)
      // so the filename stays visible.
      label: path,
      category: 'files',
    }));
  };
}
