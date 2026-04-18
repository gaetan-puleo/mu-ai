import type { Repomap, RepomapFile, SymbolEntry } from './repomap';
import { findFile } from './repomap';

function groupRefsByFile(refs: { file: string; line: number }[]): Record<string, number[]> {
  const byFile: Record<string, number[]> = {};
  for (const ref of refs) {
    if (!byFile[ref.file]) byFile[ref.file] = [];
    byFile[ref.file].push(ref.line);
  }
  return byFile;
}

function formatSymbolRefs(sym: SymbolEntry, root: string, maxRefs: number): string[] {
  const lines: string[] = [];
  if (sym.references.length === 0) return lines;

  const byFile = groupRefsByFile(sym.references);
  lines.push('      refs:');
  for (const [refFile, refLines] of Object.entries(byFile)) {
    const shortFile = refFile.replace(`${root}/`, '');
    const lineStr = refLines
      .slice(0, maxRefs)
      .sort((a, b) => a - b)
      .join(', ');
    const more = refLines.length > maxRefs ? ` +${refLines.length - maxRefs}` : '';
    lines.push(`        ${shortFile}:${lineStr}${more}`);
  }
  return lines;
}

function formatFileExports(file: RepomapFile, root: string, maxRefs: number): string[] {
  const lines: string[] = [];
  const byKind: Record<string, SymbolEntry[]> = {};
  for (const sym of file.exports) {
    if (!byKind[sym.kind]) byKind[sym.kind] = [];
    byKind[sym.kind].push(sym);
  }

  for (const [kind, syms] of Object.entries(byKind)) {
    const prefix = kind === 'fn' ? 'fn' : kind;
    lines.push(`  ${prefix}:`);
    for (const sym of syms) {
      lines.push(`    ${sym.name}`);
      lines.push(...formatSymbolRefs(sym, root, maxRefs));
    }
  }
  return lines;
}

/**
 * Tree view with references grouped by file.
 */
export function formatTree(map: Repomap, opts?: { maxFiles?: number; maxRefs?: number }): string {
  const maxFiles = opts?.maxFiles ?? 40;
  const maxRefs = opts?.maxRefs ?? 10;

  let fileArray = Array.from(map.files.values());
  fileArray.sort((a, b) => b.exports.length - a.exports.length);
  fileArray = fileArray.slice(0, maxFiles);

  let totalRefs = 0;
  for (const file of fileArray) {
    for (const sym of file.exports) {
      totalRefs += sym.references.length;
    }
  }

  const lines: string[] = [];
  lines.push(`# ${map.root.split('/').pop() || map.root}`);
  lines.push(
    `${fileArray.length} files, ${fileArray.reduce((s, f) => s + f.exports.length, 0)} exports, ${totalRefs} references`,
  );
  lines.push('');

  for (const file of fileArray) {
    const exportCount = file.exports.length;
    lines.push(`## ${file.path}`);
    lines.push(`  ${exportCount} export${exportCount !== 1 ? 's' : ''}`);
    lines.push(...formatFileExports(file, map.root, maxRefs));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Ultra-compact summary — for system prompts.
 */
export function formatSummary(map: Repomap, opts?: { maxFiles?: number }): string {
  const maxFiles = opts?.maxFiles ?? 80;
  const fileArray = Array.from(map.files.values())
    .sort((a, b) => b.exports.length - a.exports.length)
    .slice(0, maxFiles);

  const lines: string[] = [];
  lines.push(`${fileArray.length} source files`);

  for (const file of fileArray) {
    const exports = file.exports
      .filter((s) => s.kind === 'fn' || s.kind === 'class' || s.kind === 'interface')
      .slice(0, 5)
      .map((s) => s.name);

    if (exports.length > 0) {
      lines.push(`  ${file.path}: ${exports.join(', ')}`);
    } else {
      lines.push(`  ${file.path}`);
    }
  }

  return lines.join('\n');
}

function formatExportSymbol(sym: SymbolEntry, root: string): string[] {
  const lines: string[] = [];
  lines.push(`  ${sym.kind} ${sym.name} :${sym.line}`);

  if (sym.references.length > 0) {
    const byFile = groupRefsByFile(sym.references);
    lines.push('    refs:');
    for (const [refFile, refLines] of Object.entries(byFile)) {
      const shortFile = refFile.replace(`${root}/`, '');
      lines.push(`      ${shortFile}:${refLines.sort((a, b) => a - b).join(', ')}`);
    }
  }
  return lines;
}

/**
 * Detailed view for a specific file.
 */
export function formatFileView(map: Repomap, relPath: string, showInternal?: boolean): string {
  const file = findFile(map, relPath);
  if (!file) return `File not found: ${relPath}`;

  const lines: string[] = [];
  lines.push(`## ${file.path}`);
  lines.push(`  ${file.exports.length} exports`);

  if (file.exports.length > 0) {
    lines.push('');
    for (const sym of file.exports) {
      lines.push(...formatExportSymbol(sym, map.root));
    }
  }

  if (showInternal && file.internal.length > 0) {
    lines.push('');
    lines.push(`  ${file.internal.length} internal`);
    for (const sym of file.internal.slice(0, 30)) {
      lines.push(`    ${sym.kind} ${sym.name} :${sym.line}`);
    }
    if (file.internal.length > 30) {
      lines.push(`    ... ${file.internal.length - 30} more`);
    }
  }

  return lines.join('\n');
}
