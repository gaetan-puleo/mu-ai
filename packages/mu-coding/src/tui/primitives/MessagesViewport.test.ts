import { describe, expect, it } from 'bun:test';
import { buildLineOffsets, computeScrollbar, countWrappedLines, findRowAtLine, wrapText } from './MessagesViewport';

describe('countWrappedLines', () => {
  it('returns 1 for empty input', () => {
    expect(countWrappedLines('', 80)).toBe(1);
  });

  it('returns 1 for a width-fitting single line', () => {
    expect(countWrappedLines('hello world', 80)).toBe(1);
  });

  it('counts explicit newlines as separate lines', () => {
    expect(countWrappedLines('a\nb\nc', 80)).toBe(3);
  });

  it('preserves blank lines from consecutive newlines', () => {
    expect(countWrappedLines('a\n\nb', 80)).toBe(3);
  });

  it('word-wraps at the nearest whitespace', () => {
    expect(countWrappedLines('aaaaaaaaaaa bbbbbbbbbbb', 12)).toBe(2);
  });

  it('hard-breaks a word longer than the width', () => {
    expect(countWrappedLines('abcdefghijklmnopqrstuvwxy', 10)).toBe(3);
  });

  it('counts CJK characters as width 2', () => {
    expect(countWrappedLines('你好世界吗', 10)).toBe(1);
    expect(countWrappedLines('你好世界吗', 8)).toBe(2);
  });

  it('returns 1 for zero or negative width', () => {
    expect(countWrappedLines('anything', 0)).toBe(1);
    expect(countWrappedLines('anything', -5)).toBe(1);
  });
});

describe('wrapText', () => {
  it('returns a single empty line for empty input', () => {
    expect(wrapText('', 10)).toEqual(['']);
  });

  it('splits long text into multiple wrapped lines', () => {
    const lines = wrapText('hello world this is a test', 11);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // Reconstructed (joined with spaces) should approximate input.
    expect(lines.join(' ').replace(/\s+/g, ' ').trim()).toContain('hello world');
  });

  it('keeps explicit newlines as separate entries', () => {
    expect(wrapText('a\nb\nc', 80)).toEqual(['a', 'b', 'c']);
  });

  it('hard-breaks an overlong word', () => {
    const lines = wrapText('abcdefghij', 4);
    expect(lines).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('preserves CJK width-2 chars across wraps', () => {
    const lines = wrapText('你好世界', 4);
    // 4 cols = 2 CJK chars per line → 2 lines of 2 chars each
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe('你好');
    expect(lines[1]).toBe('世界');
  });
});

describe('computeScrollbar', () => {
  it('returns zero thumb when barHeight is 0', () => {
    expect(computeScrollbar(100, 10, 0, 0)).toEqual({ thumbTop: 0, thumbHeight: 0 });
  });

  it('puts the thumb at the top when scrolled to 0', () => {
    const { thumbTop, thumbHeight } = computeScrollbar(100, 25, 0, 20);
    expect(thumbTop).toBe(0);
    expect(thumbHeight).toBe(5);
  });

  it('puts the thumb at the bottom when fully scrolled', () => {
    const { thumbTop, thumbHeight } = computeScrollbar(100, 25, 75, 20);
    expect(thumbHeight).toBe(5);
    expect(thumbTop).toBe(15);
  });

  it('clamps thumb height to at least 1 even with very large totalLines', () => {
    const { thumbHeight } = computeScrollbar(10000, 1, 0, 10);
    expect(thumbHeight).toBe(1);
  });

  it('places the thumb proportionally when partially scrolled', () => {
    const { thumbTop, thumbHeight } = computeScrollbar(100, 20, 40, 20);
    expect(thumbHeight).toBe(4);
    expect(thumbTop).toBe(8);
  });
});

describe('buildLineOffsets', () => {
  it('returns [0] for empty input', () => {
    expect(buildLineOffsets([])).toEqual([0]);
  });

  it('builds correct prefix sums', () => {
    expect(buildLineOffsets([2, 3, 1, 4])).toEqual([0, 2, 5, 6, 10]);
  });

  it('handles a single row', () => {
    expect(buildLineOffsets([5])).toEqual([0, 5]);
  });
});

describe('findRowAtLine', () => {
  it('returns 0/0 for empty offsets', () => {
    expect(findRowAtLine([0], 0)).toEqual({ rowIndex: 0, lineWithinRow: 0 });
  });

  it('finds line 0 in the first row', () => {
    // rows of [3, 2, 4] → cum [0,3,5,9]
    expect(findRowAtLine([0, 3, 5, 9], 0)).toEqual({ rowIndex: 0, lineWithinRow: 0 });
    expect(findRowAtLine([0, 3, 5, 9], 2)).toEqual({ rowIndex: 0, lineWithinRow: 2 });
  });

  it('finds a line inside the second row', () => {
    expect(findRowAtLine([0, 3, 5, 9], 3)).toEqual({ rowIndex: 1, lineWithinRow: 0 });
    expect(findRowAtLine([0, 3, 5, 9], 4)).toEqual({ rowIndex: 1, lineWithinRow: 1 });
  });

  it('finds a line inside the third row', () => {
    expect(findRowAtLine([0, 3, 5, 9], 5)).toEqual({ rowIndex: 2, lineWithinRow: 0 });
    expect(findRowAtLine([0, 3, 5, 9], 8)).toEqual({ rowIndex: 2, lineWithinRow: 3 });
  });
});

describe('ViewportRow line accounting (via buildLineOffsets)', () => {
  // The line accounting per row is `paddingTop + wrapped.length + paddingBottom + marginBottom`.
  // Here we sanity-check the formula across realistic combos by simulating
  // what the component does when building rowLines.
  function lineCountOf(opts: {
    text: string;
    cols: number;
    paddingTop?: number;
    paddingBottom?: number;
    marginBottom?: number;
  }): number {
    const pt = opts.paddingTop ?? 0;
    const pb = opts.paddingBottom ?? 0;
    const mb = opts.marginBottom ?? 1;
    return pt + countWrappedLines(opts.text, opts.cols) + pb + mb;
  }

  it('plain assistant message (1 wrapped + 1 margin = 2)', () => {
    expect(lineCountOf({ text: 'hi', cols: 40 })).toBe(2);
  });

  it('user message with paddingTop+paddingBottom (1+1+1+1 = 4)', () => {
    expect(lineCountOf({ text: 'hi', cols: 40, paddingTop: 1, paddingBottom: 1 })).toBe(4);
  });

  it('user message containing a wrapped paragraph (1 + wrap + 1 + 1)', () => {
    const wrap = countWrappedLines('one two three four five', 10);
    expect(lineCountOf({ text: 'one two three four five', cols: 10, paddingTop: 1, paddingBottom: 1 })).toBe(
      1 + wrap + 1 + 1,
    );
    // Sanity: at width 10 this paragraph wraps to 3 visual lines.
    expect(wrap).toBe(3);
  });

  it('reasoning row with marginBottom=0 collapses to its content', () => {
    expect(lineCountOf({ text: 'thinking…', cols: 40, marginBottom: 0 })).toBe(1);
  });

  it('row with zero margin and no padding', () => {
    expect(lineCountOf({ text: 'x', cols: 40, marginBottom: 0 })).toBe(1);
  });
});
