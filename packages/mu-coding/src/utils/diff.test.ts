import { describe, expect, it } from 'bun:test';
import { computeDiff, renderDiff } from './diff';

describe('computeDiff', () => {
  it('emits only context lines when texts are identical', () => {
    const diff = computeDiff('a\nb\nc', 'a\nb\nc');
    expect(diff.lines.every((l) => l.type === 'context')).toBe(true);
    expect(diff.lines.find((l) => l.type === 'old')).toBeUndefined();
    expect(diff.lines.find((l) => l.type === 'new')).toBeUndefined();
    expect(diff.totalOldLines).toBe(3);
    expect(diff.totalNewLines).toBe(3);
  });

  it('detects an added line in the middle', () => {
    const diff = computeDiff('a\nb\nc', 'a\nx\nb\nc');
    const types = diff.lines.map((l) => l.type);
    expect(types).toContain('new');
    expect(diff.lines.find((l) => l.type === 'new')?.value).toBe('x');
  });

  it('detects a removed line', () => {
    const diff = computeDiff('a\nb\nc', 'a\nc');
    expect(diff.lines.find((l) => l.type === 'old')?.value).toBe('b');
  });

  it('returns no lines when either side exceeds the size limit', () => {
    const huge = Array.from({ length: 600 }, (_, i) => `line${i}`).join('\n');
    const diff = computeDiff(huge, huge.replace('line0', 'lineX'));
    expect(diff.lines).toEqual([]);
    expect(diff.totalOldLines).toBe(600);
  });

  it('emits up to CONTEXT_LINES of leading/trailing context', () => {
    const diff = computeDiff('a\nb\nc\nd\ne', 'a\nb\nc\nX\ne');
    const contextValues = diff.lines.filter((l) => l.type === 'context').map((l) => l.value);
    expect(contextValues).toContain('c');
    expect(contextValues).toContain('e');
  });
});

describe('renderDiff', () => {
  it('prefixes added/removed/context lines and reports truncation', () => {
    const diff = computeDiff('a\nb', 'a\nc');
    const { lines, truncated } = renderDiff(diff, 100);
    expect(lines.some((l) => l.startsWith('-'))).toBe(true);
    expect(lines.some((l) => l.startsWith('+'))).toBe(true);
    expect(truncated).toBe(false);
  });

  it('reports truncated when diff exceeds maxLines', () => {
    const diff = computeDiff('a', Array.from({ length: 50 }, (_, i) => `n${i}`).join('\n'));
    const { lines, truncated } = renderDiff(diff, 5);
    expect(lines).toHaveLength(5);
    expect(truncated).toBe(true);
  });
});
