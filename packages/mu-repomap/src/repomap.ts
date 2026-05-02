import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger, type RepomapLogger } from './logger';
import { pLimit } from './utils/p-limit';

// --- Types ---

export interface SymbolLoc {
  file: string;
  line: number;
  kind: 'fn' | 'class' | 'interface' | 'type' | 'const' | 'var' | 'enum' | 'other';
  export: boolean;
  name: string;
}

export interface SymbolEntry extends SymbolLoc {
  references: { file: string; line: number }[];
}

export interface RepomapFile {
  path: string;
  exports: SymbolEntry[];
}

export interface Repomap {
  version: 1;
  root: string;
  builtAt: string;
  files: Map<string, RepomapFile>;
}

// --- SG CLI wrapper ---

/**
 * Locate the `sg` (ast-grep) binary, preferring the copy shipped with this
 * package so the host doesn't accidentally invoke `/usr/bin/sg` — which on
 * Debian-family systems is the `newgrp` setgid helper, not ast-grep.
 *
 * Resolution order:
 *   1. `<this-package>/node_modules/.bin/sg` (always present when installed
 *      via npm; symlinked when installed in a workspace)
 *   2. Walk up from this file looking for a `node_modules/.bin/sg` (covers
 *      the monorepo root, where bun hoists @ast-grep/cli)
 *   3. `<process.cwd()>/node_modules/.bin/sg` (legacy behaviour)
 *   4. Bare `sg` from PATH — only if it self-identifies as ast-grep via
 *      `sg --version`. Otherwise we throw rather than silently invoking
 *      newgrp, which causes scans to "succeed" with empty results.
 */
function looksLikeAstGrep(bin: string): boolean {
  try {
    const out = execFileSync(bin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).toString();
    return /ast-grep/i.test(out);
  } catch {
    return false;
  }
}

function resolveSgBin(): string {
  const candidates: string[] = [];

  // 1. Sibling node_modules of this package (always present after install).
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(here, '..', 'node_modules', '.bin', 'sg'));
    // 2. Walk up to find a hoisted binary (workspace / monorepo root).
    let dir = here;
    for (let i = 0; i < 8; i++) {
      const parent = dirname(dir);
      if (parent === dir) break;
      candidates.push(join(parent, 'node_modules', '.bin', 'sg'));
      dir = parent;
    }
  } catch {
    // import.meta.url unavailable — fall through.
  }

  // 3. Caller's cwd (legacy fallback for hosts that pre-install ast-grep).
  candidates.push(join(process.cwd(), 'node_modules', '.bin', 'sg'));

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  // 4. PATH lookup — verify it's actually ast-grep, not /usr/bin/sg (newgrp).
  if (looksLikeAstGrep('sg')) return 'sg';

  throw new Error(
    'ast-grep binary not found. Install `@ast-grep/cli` in your project, or ensure mu-repomap was installed with its dependencies.',
  );
}

/**
 * Run `sg` and resolve with stdout. ast-grep follows ripgrep/grep semantics
 * and exits **1 when no matches were found**; only exit codes ≥ 2 indicate a
 * real failure. We unwrap that here so callers don't have to special-case the
 * empty-result path (which would otherwise blow up loudly any time a single
 * `DECL_PATTERNS` entry — say `enum $NAME` in a JS-only project — yielded no
 * hits, or when scanning a config dir with no source files at all).
 */
function runSg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(resolveSgBin(), args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
      if (!err) {
        resolve(stdout);
        return;
      }
      // execFile callback errors carry the process exit code as `.code`
      // (number) — distinct from the typed `NodeJS.ErrnoException.code`
      // (string ENOENT/EACCES/…) used for spawn failures.
      const code = (err as { code?: number | string }).code;
      if (code === 1) {
        // "no matches" — return whatever stdout we got (typically `[]`).
        resolve(stdout);
        return;
      }
      reject(err);
    });
  });
}

// --- File discovery ---

export const SOURCE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.c',
  '.cpp',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.dart',
  '.lua',
  '.sh',
  '.bash',
]);

// --- SG patterns ---

const DECL_PATTERNS = ['function $NAME', 'class $NAME', 'interface $NAME', 'type $NAME', 'const $NAME', 'enum $NAME'];

function detectKind(pattern: string): SymbolLoc['kind'] {
  if (pattern.includes('function')) return 'fn';
  if (pattern.includes('class')) return 'class';
  if (pattern.includes('interface')) return 'interface';
  if (pattern.includes('type')) return 'type';
  if (pattern.includes('const')) return 'const';
  if (pattern.includes('enum')) return 'enum';
  return 'other';
}

interface SgMatch {
  text: string;
  file: string;
  lines: string;
  range: { start: { line: number } };
  metaVariables?: { single: Record<string, { text: string }> };
}

function parseSgJson(output: string): SgMatch[] {
  try {
    const data = JSON.parse(output);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// --- Index building ---

function matchToSymbol(m: SgMatch, kind: SymbolLoc['kind']): SymbolLoc | null {
  const mv = m.metaVariables?.single ?? {};
  let name = Object.values(mv)[0]?.text ?? '?';

  if (kind === 'const') {
    name = name.split(/[:\s=]/)[0].trim();
  }

  const line = m.range.start.line + 1;
  const exportFlag = /^export\s/.test(m.lines) || /^pub\s/.test(m.lines);

  if (kind === 'const' && !exportFlag) return null;
  if (name.startsWith('_')) return null;

  return { file: m.file, line, kind, export: exportFlag, name };
}

async function scanPattern(pattern: string, root: string): Promise<SymbolLoc[]> {
  const output = await runSg(['run', '--pattern', pattern, '--json', root]);
  const matches = parseSgJson(output);
  const kind = detectKind(pattern);
  const out: SymbolLoc[] = [];
  for (const m of matches) {
    const sym = matchToSymbol(m, kind);
    if (sym) out.push(sym);
  }
  return out;
}

async function scanDeclarations(root: string, log: RepomapLogger): Promise<SymbolLoc[]> {
  const all: SymbolLoc[] = [];
  let firstError: unknown = null;

  for (const pattern of DECL_PATTERNS) {
    try {
      all.push(...(await scanPattern(pattern, root)));
    } catch (err) {
      if (!firstError) firstError = err;
    }
  }

  if (all.length === 0 && firstError) {
    // Surface the underlying ast-grep failure once so users see *something*
    // instead of an empty repomap. Most common cause: wrong `sg` binary on
    // PATH or missing @ast-grep/cli install.
    const msg = firstError instanceof Error ? firstError.message : String(firstError);
    log.notify(`ast-grep scan failed: ${msg}`, 'error');
  }

  return all;
}

// --- Reference scanning ---

async function scanReferences(name: string, root: string): Promise<{ file: string; line: number }[]> {
  try {
    const output = await runSg(['run', '--pattern', name, '--json', root]);
    const matches = parseSgJson(output);

    const seen = new Set<string>();
    const refs: { file: string; line: number }[] = [];

    for (const m of matches) {
      const line = m.range.start.line + 1;
      const key = `${m.file}:${line}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ file: m.file, line });
      }
    }

    return refs;
  } catch {
    return [];
  }
}

async function scanAllReferences(symbols: SymbolLoc[], root: string): Promise<Map<string, SymbolEntry[]>> {
  const result = new Map<string, SymbolEntry[]>();
  const seen = new Set<string>();

  const nameGroups = new Map<string, SymbolLoc[]>();
  for (const sym of symbols) {
    const key = `${sym.file}:${sym.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = nameGroups.get(sym.name);
    if (group) {
      group.push(sym);
    } else {
      nameGroups.set(sym.name, [sym]);
    }
  }

  const limit = pLimit(10);
  const scanPromises = Array.from(nameGroups.entries()).map(([name, syms]) =>
    limit(() => scanReferences(name, root).then((refs) => ({ name, syms, refs }))),
  );

  interface ScanResult {
    name: string;
    syms: SymbolLoc[];
    refs: { file: string; line: number }[];
  }
  const results = (await Promise.all(scanPromises)) as ScanResult[];

  for (const { syms, refs } of results) {
    for (const sym of syms) {
      const entry: SymbolEntry = { ...sym, references: refs };
      const rel = relative(root, sym.file);
      const group = result.get(rel);
      if (group) {
        group.push(entry);
      } else {
        result.set(rel, [entry]);
      }
    }
  }

  return result;
}

// --- Persistence ---

function getCacheBase(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  return xdg ? join(xdg, 'mu') : join(homedir(), '.cache', 'mu');
}

function getRepomapPath(root: string): string {
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 12);
  const name = root.split('/').pop() || 'project';
  return join(getCacheBase(), 'repomap', `${name}-${hash}`, 'index.json');
}

function saveRepomap(path: string, map: Repomap): void {
  const dir = path.substring(0, path.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  const serializable = {
    version: map.version,
    root: map.root,
    builtAt: map.builtAt,
    files: Array.from(map.files.entries()),
  };
  writeFileSync(path, JSON.stringify(serializable, null, 2));
}

function loadRepomap(path: string, root: string): Repomap | null {
  try {
    if (!existsSync(path)) return null;
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    if (data.root !== root) return null;
    const cacheTime = new Date(data.builtAt).getTime();
    if (Date.now() - cacheTime > 5 * 60 * 1000) return null;

    const files = new Map<string, RepomapFile>();
    for (const [k, v] of data.files) files.set(k, v);
    return { version: data.version, root: data.root, builtAt: data.builtAt, files };
  } catch {
    return null;
  }
}

// --- Main build ---

export async function buildRepomap(root: string, force = false, logger?: RepomapLogger): Promise<Repomap> {
  const log = logger ?? createLogger(undefined);
  const path = getRepomapPath(root);

  if (!force) {
    const existing = loadRepomap(path, root);
    if (existing) {
      return existing;
    }
  }

  const symbols = await scanDeclarations(root, log);
  const symbolMap = await scanAllReferences(symbols, root);

  const files = new Map<string, RepomapFile>();
  for (const [relPath, entries] of symbolMap) {
    files.set(relPath, { path: relPath, exports: entries });
  }

  const map: Repomap = {
    version: 1,
    root,
    builtAt: new Date().toISOString(),
    files,
  };

  saveRepomap(path, map);
  log.clearProgress();
  return map;
}

// --- Query ---

export function findSymbol(map: Repomap, name: string): SymbolEntry[] {
  const key = name.toLowerCase();
  const results: SymbolEntry[] = [];
  for (const file of map.files.values()) {
    for (const sym of file.exports) {
      if (sym.name.toLowerCase() === key) results.push(sym);
    }
  }
  return results;
}

export function findFile(map: Repomap, pattern: string): RepomapFile | null {
  for (const file of map.files.values()) {
    if (file.path.includes(pattern)) return file;
  }
  return null;
}

// --- Layered discovery helpers (used by list_symbols) ---

export interface RootSummary {
  /** First path segment, e.g. `packages` or `src`. */
  root: string;
  /** Number of files whose relative path begins with this root. */
  files: number;
  /** Total exports across those files. */
  exports: number;
}

/**
 * Aggregate the index by the first path segment of each file. Used by L0 of
 * `list_symbols` to surface the top-level layout without dumping every file.
 */
export function groupByRoot(map: Repomap): RootSummary[] {
  const acc = new Map<string, { files: number; exports: number }>();
  for (const file of map.files.values()) {
    const segs = file.path.split('/');
    const root = segs.length > 1 ? segs[0] : '.';
    const cur = acc.get(root) ?? { files: 0, exports: 0 };
    cur.files += 1;
    cur.exports += file.exports.length;
    acc.set(root, cur);
  }
  return Array.from(acc.entries())
    .map(([root, v]) => ({ root, files: v.files, exports: v.exports }))
    .sort((a, b) => a.root.localeCompare(b.root));
}

export interface DirListing {
  subdirs: { path: string; files: number; exports: number }[];
  files: { path: string; exports: number }[];
}

/**
 * Non-recursive listing of `prefix`: returns files directly under `prefix`
 * (no further `/` after the prefix) plus the immediate sub-directories with
 * aggregated counts. Pass `''` to list the project root.
 */
export function listDir(map: Repomap, prefix: string): DirListing {
  const normalized = prefix.replace(/^\/+|\/+$/g, '');
  const head = normalized.length === 0 ? '' : `${normalized}/`;
  const subAcc = new Map<string, { files: number; exports: number }>();
  const files: { path: string; exports: number }[] = [];

  for (const file of map.files.values()) {
    if (head && !file.path.startsWith(head)) continue;
    const rest = head ? file.path.slice(head.length) : file.path;
    if (!rest.includes('/')) {
      // File directly under prefix.
      files.push({ path: file.path, exports: file.exports.length });
      continue;
    }
    // Sub-directory: aggregate by the first segment after `head`.
    const subSeg = rest.slice(0, rest.indexOf('/'));
    const subPath = head ? `${head}${subSeg}` : subSeg;
    const cur = subAcc.get(subPath) ?? { files: 0, exports: 0 };
    cur.files += 1;
    cur.exports += file.exports.length;
    subAcc.set(subPath, cur);
  }

  return {
    subdirs: Array.from(subAcc.entries()).map(([path, v]) => ({
      path,
      files: v.files,
      exports: v.exports,
    })),
    files,
  };
}

/**
 * Disambiguating lookup: returns the export symbol with `name` defined in
 * the file matching `filePath` (exact, suffix, or substring), or null if
 * no match is found.
 */
export function findSymbolInFile(map: Repomap, name: string, filePath: string): SymbolEntry | null {
  const key = name.toLowerCase();
  const file =
    map.files.get(filePath) ??
    Array.from(map.files.values()).find((f) => f.path === filePath || f.path.endsWith(`/${filePath}`)) ??
    Array.from(map.files.values()).find((f) => f.path.includes(filePath));
  if (!file) return null;
  for (const sym of file.exports) {
    if (sym.name.toLowerCase() === key) return sym;
  }
  return null;
}
