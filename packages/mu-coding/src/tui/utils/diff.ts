/**
 * Line-level diff between two strings. Returns an array of changes with
 * 'add' / 'remove' / 'context' markers. Small, dependency-free LCS-based.
 */

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  text: string;
}

export function diffLines(a: string, b: string): DiffLine[] {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const n = aLines.length;
  const m = bLines.length;

  // Longest-common-subsequence table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      lcs[i + 1]![j + 1] = aLines[i] === bLines[j] ? (lcs[i]![j] ?? 0) + 1 : Math.max(lcs[i + 1]![j] ?? 0, lcs[i]![j + 1] ?? 0);
    }
  }

  // Backtrack.
  const out: DiffLine[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (aLines[i - 1] === bLines[j - 1]) {
      out.unshift({ type: 'context', text: aLines[i - 1] ?? '' });
      i--;
      j--;
    } else if ((lcs[i - 1]![j] ?? 0) >= (lcs[i]![j - 1] ?? 0)) {
      out.unshift({ type: 'remove', text: aLines[i - 1] ?? '' });
      i--;
    } else {
      out.unshift({ type: 'add', text: bLines[j - 1] ?? '' });
      j--;
    }
  }
  while (i > 0) {
    out.unshift({ type: 'remove', text: aLines[i - 1] ?? '' });
    i--;
  }
  while (j > 0) {
    out.unshift({ type: 'add', text: bLines[j - 1] ?? '' });
    j--;
  }
  return out;
}
