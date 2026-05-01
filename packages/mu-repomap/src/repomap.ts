import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
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
  internal: SymbolLoc[];
}

export interface Repomap {
  version: 1;
  root: string;
  builtAt: string;
  files: Map<string, RepomapFile>;
}

// --- SG CLI wrapper ---

const SG_BIN = (() => {
  const local = join(process.cwd(), 'node_modules/.bin/sg');
  if (existsSync(local)) return local;
  return 'sg';
})();

function runSg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(SG_BIN, args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
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

async function scanDeclarations(root: string): Promise<SymbolLoc[]> {
  const all: SymbolLoc[] = [];

  for (const pattern of DECL_PATTERNS) {
    try {
      const output = await runSg(['run', '--pattern', pattern, '--json', root]);
      const matches = parseSgJson(output);
      const kind = detectKind(pattern);

      for (const m of matches) {
        const mv = m.metaVariables?.single ?? {};
        let name = Object.values(mv)[0]?.text ?? '?';

        if (kind === 'const') {
          name = name.split(/[:\s=]/)[0].trim();
        }

        const line = m.range.start.line + 1;
        const exportFlag = /^export\s/.test(m.lines) || /^pub\s/.test(m.lines);

        if (kind === 'const' && !exportFlag) continue;
        if (name.startsWith('_')) continue;

        all.push({ file: m.file, line, kind, export: exportFlag, name });
      }
    } catch {
      // skip
    }
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
      log.notify(`Cache hit: ${existing.files.size} files`, 'info');
      return existing;
    }
  }

  const t0 = Date.now();
  log.progress('Building...');

  log.progress('Phase 1: scanning declarations...');
  const symbols = await scanDeclarations(root);
  log.progress(`${symbols.length} declarations found`);

  log.progress('Phase 2: scanning references...');
  const t1 = Date.now();
  const symbolMap = await scanAllReferences(symbols, root);
  log.progress(`References scanned in ${Date.now() - t1}ms`);

  const files = new Map<string, RepomapFile>();
  for (const [relPath, entries] of symbolMap) {
    files.set(relPath, { path: relPath, exports: entries, internal: [] });
  }

  const map: Repomap = {
    version: 1,
    root,
    builtAt: new Date().toISOString(),
    files,
  };

  saveRepomap(path, map);
  log.clearProgress();
  log.notify(`Done in ${Date.now() - t0}ms — ${files.size} files`, 'success');
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
