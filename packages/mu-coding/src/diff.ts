// Lightweight diff for edit_file tool output.
// Uses prefix/suffix matching — sufficient for small, localized edits.

export interface DiffLine {
  type: 'context' | 'old' | 'new';
  value: string;
}

export interface DiffResult {
  lines: DiffLine[];
  totalOldLines: number;
  totalNewLines: number;
}

const CONTEXT_LINES = 3;
const MAX_LINES = 500;

export function computeDiff(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  if (oldLines.length > MAX_LINES || newLines.length > MAX_LINES) {
    return { lines: [], totalOldLines: oldLines.length, totalNewLines: newLines.length };
  }

  // Find common prefix
  let prefixLen = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (prefixLen < minLen && oldLines[prefixLen] === newLines[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (don't overlap with prefix)
  let suffixLen = 0;
  const maxSuffix = Math.min(oldLines.length - prefixLen, newLines.length - prefixLen);
  while (
    suffixLen < maxSuffix &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const result: DiffLine[] = [];

  // Context from prefix (last N lines)
  const ctxStart = Math.max(0, prefixLen - CONTEXT_LINES);
  for (let i = ctxStart; i < prefixLen; i++) {
    result.push({ type: 'context', value: oldLines[i] });
  }

  // Removed lines
  for (let i = prefixLen; i < oldLines.length - suffixLen; i++) {
    result.push({ type: 'old', value: oldLines[i] });
  }

  // Added lines
  for (let i = prefixLen; i < newLines.length - suffixLen; i++) {
    result.push({ type: 'new', value: newLines[i] });
  }

  // Context from suffix (first N lines)
  const ctxEnd = Math.min(suffixLen, CONTEXT_LINES);
  for (let i = 0; i < ctxEnd; i++) {
    const idx = oldLines.length - suffixLen + i;
    result.push({ type: 'context', value: oldLines[idx] });
  }

  return { lines: result, totalOldLines: oldLines.length, totalNewLines: newLines.length };
}

export function renderDiff(diff: DiffResult, maxLines: number): { lines: string[]; truncated: boolean } {
  const result: string[] = [];
  const capped = diff.lines.slice(0, maxLines);

  for (const line of capped) {
    const prefix = line.type === 'old' ? '-' : line.type === 'new' ? '+' : ' ';
    result.push(`${prefix} ${line.value}`);
  }

  return { lines: result, truncated: diff.lines.length > maxLines };
}
