import { findSymbolInFile, groupByRoot, listDir, type Repomap, type SymbolEntry } from './repomap';

export interface ListSymbolsArgs {
  /** "" | "dir:<path>" | "file:<path>" | "sym:<name>[@<file>]" */
  query?: string;
  /** 1-indexed page number. Defaults to 1. */
  page?: number;
  /** Override the per-page item count. Defaults to {@link DEFAULT_PAGE_SIZE}. */
  pageSize?: number;
}

export const DEFAULT_PAGE_SIZE = 20;

interface PageMeta {
  page: number;
  totalPages: number;
  totalItems: number;
  shownItems: number;
}

function paginate<T>(items: T[], page: number, pageSize: number): { slice: T[]; meta: PageMeta } {
  const safeSize = Math.max(1, pageSize);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safeSize));
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * safeSize;
  const end = start + safeSize;
  const slice = items.slice(start, end);
  return {
    slice,
    meta: {
      page: safePage,
      totalPages,
      totalItems,
      shownItems: slice.length,
    },
  };
}

function formatFooter(meta: PageMeta, nextHint?: string): string {
  const tag = meta.page >= meta.totalPages ? ' — end' : '';
  const head = `Page ${meta.page}/${meta.totalPages} — ${meta.shownItems} of ${meta.totalItems} shown${tag}`;
  if (meta.page < meta.totalPages && nextHint) {
    return `${head}\nNext: ${nextHint}`;
  }
  return head;
}

// ─── L0: root directories ────────────────────────────────────────────────────

function formatRoots(map: Repomap, page: number, pageSize: number): string {
  const roots = groupByRoot(map);
  if (roots.length === 0) return 'No source files indexed yet.';

  const { slice, meta } = paginate(roots, page, pageSize);
  const lines: string[] = [];
  lines.push(`# Project roots (${meta.totalItems})`);
  lines.push('');
  for (const r of slice) {
    lines.push(`  ${r.root}/  (${r.files} files, ${r.exports} exports)`);
  }
  lines.push('');
  const nextHint =
    meta.page < meta.totalPages
      ? `list_symbols(page:${meta.page + 1})`
      : 'list_symbols("dir:<path>") to drill into a root';
  lines.push(formatFooter(meta, nextHint));
  return lines.join('\n');
}

// ─── L1: directory listing (immediate files + subdirs) ──────────────────────

interface DirEntry {
  kind: 'dir' | 'file';
  path: string;
  files?: number;
  exports: number;
}

function formatDir(map: Repomap, prefix: string, page: number, pageSize: number): string {
  const cleanPrefix = prefix.replace(/\/+$/, '');
  const { subdirs, files } = listDir(map, cleanPrefix);
  if (subdirs.length === 0 && files.length === 0) {
    return `Directory not found or empty: ${cleanPrefix}`;
  }

  // Stable order: subdirs first (alpha), then files (alpha).
  const entries: DirEntry[] = [
    ...subdirs
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((d) => ({ kind: 'dir' as const, path: d.path, files: d.files, exports: d.exports })),
    ...files
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((f) => ({ kind: 'file' as const, path: f.path, exports: f.exports })),
  ];

  const { slice, meta } = paginate(entries, page, pageSize);
  const lines: string[] = [];
  lines.push(`# ${cleanPrefix}/  (${subdirs.length} subdir(s), ${files.length} file(s))`);
  lines.push('');
  for (const e of slice) {
    if (e.kind === 'dir') {
      lines.push(`  ${e.path}/  (${e.files} files, ${e.exports} exports)`);
    } else {
      lines.push(`  ${e.path}  (${e.exports} exports)`);
    }
  }
  lines.push('');
  const nextHint =
    meta.page < meta.totalPages
      ? `list_symbols("dir:${cleanPrefix}", page:${meta.page + 1})`
      : 'list_symbols("dir:<sub>") or list_symbols("file:<path>") to descend';
  lines.push(formatFooter(meta, nextHint));
  return lines.join('\n');
}

// ─── L2: file exports ───────────────────────────────────────────────────────

function formatFileExports(map: Repomap, relPath: string, page: number, pageSize: number): string {
  // Substring-tolerant lookup: try exact first, then any path containing the input.
  const file =
    map.files.get(relPath) ??
    Array.from(map.files.values()).find((f) => f.path === relPath || f.path.endsWith(`/${relPath}`)) ??
    Array.from(map.files.values()).find((f) => f.path.includes(relPath));
  if (!file) return `File not found: ${relPath}`;

  // Sort by line ascending — predictable for pagination.
  const exports = file.exports.slice().sort((a, b) => a.line - b.line);
  const { slice, meta } = paginate(exports, page, pageSize);

  const lines: string[] = [];
  lines.push(`# ${file.path}  (${file.exports.length} exports)`);
  lines.push('');
  for (const sym of slice) {
    const flag = sym.export ? 'export' : 'internal';
    lines.push(`  ${sym.kind} ${sym.name} :${sym.line}  (${flag})`);
  }
  lines.push('');
  const nextHint =
    meta.page < meta.totalPages
      ? `list_symbols("file:${file.path}", page:${meta.page + 1})`
      : 'list_symbols("sym:<name>") to inspect a symbol';
  lines.push(formatFooter(meta, nextHint));
  return lines.join('\n');
}

// ─── L3: symbol definition + refs ───────────────────────────────────────────

function findSymbolMatches(map: Repomap, name: string, fileFilter?: string): SymbolEntry[] {
  if (fileFilter) {
    const exact = findSymbolInFile(map, name, fileFilter);
    return exact ? [exact] : [];
  }
  const key = name.toLowerCase();
  const out: SymbolEntry[] = [];
  for (const file of map.files.values()) {
    for (const sym of file.exports) {
      if (sym.name.toLowerCase() === key) out.push(sym);
    }
  }
  return out;
}

function formatHomonyms(name: string, matches: SymbolEntry[], root: string): string {
  const lines: string[] = [];
  lines.push(`# "${name}" — ${matches.length} candidates (ambiguous)`);
  lines.push('');
  for (const m of matches) {
    const rel = m.file.replace(`${root}/`, '');
    lines.push(`  ${m.kind} ${name} @ ${rel}:${m.line}`);
  }
  lines.push('');
  lines.push(`Refine: list_symbols("sym:${name}@<file>")`);
  return lines.join('\n');
}

interface RefRow {
  file: string;
  line: number;
}

function formatSymbolWithRefs(
  map: Repomap,
  name: string,
  fileFilter: string | undefined,
  page: number,
  pageSize: number,
): string {
  const matches = findSymbolMatches(map, name, fileFilter);
  if (matches.length === 0) {
    return fileFilter ? `Symbol not found: ${name}@${fileFilter}` : `Symbol not found: ${name}`;
  }
  if (matches.length > 1 && !fileFilter) {
    return formatHomonyms(name, matches, map.root);
  }

  const sym = matches[0];
  const rel = sym.file.replace(`${map.root}/`, '');
  const refs: RefRow[] = sym.references
    .slice()
    .sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)))
    .map((r) => ({ file: r.file.replace(`${map.root}/`, ''), line: r.line }));

  const { slice, meta } = paginate(refs, page, pageSize);
  const lines: string[] = [];
  lines.push(`# ${sym.kind} ${sym.name}`);
  lines.push(`  defined at ${rel}:${sym.line}  (${sym.export ? 'export' : 'internal'})`);
  lines.push('');
  if (refs.length === 0) {
    lines.push('  no references found');
    lines.push('');
    lines.push(formatFooter(meta));
    return lines.join('\n');
  }
  lines.push(`  references (${refs.length}):`);
  for (const r of slice) {
    lines.push(`    ${r.file}:${r.line}`);
  }
  lines.push('');
  const qualifier = fileFilter ? `@${rel}` : '';
  const nextHint =
    meta.page < meta.totalPages ? `list_symbols("sym:${name}${qualifier}", page:${meta.page + 1})` : undefined;
  lines.push(formatFooter(meta, nextHint));
  return lines.join('\n');
}

// ─── Entry point ─────────────────────────────────────────────────────────────

interface ParsedQuery {
  kind: 'roots' | 'dir' | 'file' | 'sym';
  target: string;
  fileFilter?: string;
}

function parseQuery(raw: string): ParsedQuery {
  const q = raw.trim();
  if (!q) return { kind: 'roots', target: '' };
  if (q.startsWith('dir:')) return { kind: 'dir', target: q.slice(4).trim() };
  if (q.startsWith('file:')) return { kind: 'file', target: q.slice(5).trim() };
  if (q.startsWith('sym:')) {
    const rest = q.slice(4).trim();
    const at = rest.indexOf('@');
    if (at >= 0) {
      return { kind: 'sym', target: rest.slice(0, at).trim(), fileFilter: rest.slice(at + 1).trim() };
    }
    return { kind: 'sym', target: rest };
  }
  // Bare token → treat as a symbol query (forgiving fallback).
  return { kind: 'sym', target: q };
}

export function listSymbols(map: Repomap, args: ListSymbolsArgs): string {
  const page = args.page && args.page > 0 ? Math.floor(args.page) : 1;
  const pageSize = args.pageSize && args.pageSize > 0 ? Math.floor(args.pageSize) : DEFAULT_PAGE_SIZE;
  const parsed = parseQuery(args.query ?? '');

  switch (parsed.kind) {
    case 'roots':
      return formatRoots(map, page, pageSize);
    case 'dir':
      if (!parsed.target) return 'Empty dir query. Use list_symbols("dir:<path>").';
      return formatDir(map, parsed.target, page, pageSize);
    case 'file':
      if (!parsed.target) return 'Empty file query. Use list_symbols("file:<path>").';
      return formatFileExports(map, parsed.target, page, pageSize);
    case 'sym':
      if (!parsed.target) return 'Empty sym query. Use list_symbols("sym:<name>").';
      return formatSymbolWithRefs(map, parsed.target, parsed.fileFilter || undefined, page, pageSize);
  }
}
