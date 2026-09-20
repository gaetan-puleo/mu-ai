import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, sep } from 'node:path';

/** Filenames recognised as project/global instruction files, in priority order per directory. */
const DEFAULT_FILES = ['AGENTS.md', 'CLAUDE.md'];

const isUnder = (root: string, p: string): boolean => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

/** Walk from `cwd` up to the filesystem root (capped), returning dirs root-first → cwd-last. */
function ancestorDirs(cwd: string, max = 12): string[] {
  const dirs: string[] = [];
  let dir = cwd;
  for (let i = 0; i < max; i++) {
    dirs.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs.reverse();
}

/**
 * The directory chain from a file's directory UP to (and including) `cwd`. Used to scope
 * nested AGENTS.md: touching `cwd/a/b/c.ts` makes `cwd`, `cwd/a`, `cwd/a/b` relevant.
 * Returns [] when the path is outside `cwd`.
 */
export function dirsForPath(cwd: string, filePath: string): string[] {
  if (!filePath) return [];
  const abs = isAbsolute(filePath) ? filePath : join(cwd, filePath);
  if (!isUnder(cwd, abs)) return [];
  const dirs: string[] = [];
  let dir = dirname(abs);
  while (isUnder(cwd, dir)) {
    dirs.push(dir);
    if (dir === cwd) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

/** Read the first existing file (by `names`) in `dir`, returning its trimmed content. */
async function readFirst(dir: string, names: readonly string[]): Promise<{ path: string; text: string } | undefined> {
  for (const name of names) {
    const text = await readFile(join(dir, name), 'utf-8').catch(() => undefined);
    if (text && text.trim()) return { path: join(dir, name), text: text.trim() };
  }
  return undefined;
}

/**
 * Load project-instruction files (AGENTS.md / CLAUDE.md, opencode-style) across harness
 * scopes: GLOBAL (configDir, every project) and LOCAL (cwd + ancestors, project-specific),
 * plus on-demand NESTED scopes — any subdirectory the agent has touched (`accessed`) whose
 * AGENTS.md should apply while working there. Concatenated shallow → deep so the most
 * specific instructions land last. Returns undefined when nothing is found.
 */
export async function loadInstructions(
  cwd: string,
  configDir: string,
  opts?: { files?: readonly string[]; accessed?: Iterable<string> },
): Promise<string | undefined> {
  const files = opts?.files ?? DEFAULT_FILES;
  const parts: string[] = [];

  const global = await readFirst(configDir, files);
  if (global) parts.push(`<!-- global: ${global.path} -->\n${global.text}`);

  const dirSet = new Set<string>(ancestorDirs(cwd));
  for (const dir of opts?.accessed ?? []) if (isUnder(cwd, dir)) dirSet.add(dir);
  const dirs = [...dirSet]
    .filter((d) => d !== configDir)
    .sort((a, b) => a.split(sep).length - b.split(sep).length);

  for (const dir of dirs) {
    const local = await readFirst(dir, files);
    if (local) parts.push(`<!-- ${local.path} -->\n${local.text}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}
