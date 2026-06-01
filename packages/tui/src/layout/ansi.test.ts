import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';

import { cellsToAnsi, parseLine } from './ansi';

describe('parseLine', () => {
  it('parses plain text into cells', () => {
    const cells = parseLine('abc');
    expect(cells).toHaveLength(3);
    expect(cells.map((c) => c.grapheme)).toEqual(['a', 'b', 'c']);
    expect(cells.every((c) => c.width === 1)).toBe(true);
  });

  it('applies foreground SGR to subsequent cells', () => {
    const cells = parseLine('a\x1b[31mb');
    expect(cells[0].style.fg.intent).toBe('default');
    expect(cells[1].style.fg.intent).toBe('indexed');
    expect(cells[1].style.fg.index).toBe(1);
  });

  it('parses truecolor SGR', () => {
    const cells = parseLine('\x1b[38;2;255;128;0mX');
    const fg = cells[0].style.fg;
    expect(fg.intent).toBe('rgb');
    expect(fg.r).toBe(255);
    expect(fg.g).toBe(128);
    expect(fg.b).toBe(0);
  });

  it('parses background colors', () => {
    const cells = parseLine('\x1b[48;5;200mX');
    expect(cells[0].style.bg.intent).toBe('indexed');
    expect(cells[0].style.bg.index).toBe(200);
  });

  it('parses attributes', () => {
    const cells = parseLine('\x1b[1;3mX');
    expect(cells[0].style.bold).toBe(true);
    expect(cells[0].style.italic).toBe(true);
  });

  it('resets attributes on \\x1b[0m', () => {
    const cells = parseLine('\x1b[1;31mA\x1b[0mB');
    expect(cells[0].style.bold).toBe(true);
    expect(cells[1].style.bold).toBe(false);
    expect(cells[1].style.fg.intent).toBe('default');
  });

  it('handles wide characters with continuation cells', () => {
    const cells = parseLine('日');
    expect(cells).toHaveLength(2);
    expect(cells[0].width).toBe(2);
    expect(cells[0].grapheme).toBe('日');
    expect(cells[1].width).toBe(0);
  });

  it('parses OSC 8 hyperlinks', () => {
    const cells = parseLine('\x1b]8;;https://example.com\x07X\x1b]8;;\x07');
    expect(cells[0].style.link).toBe('https://example.com');
  });

  it('handles 22 (normal intensity) by clearing bold and dim', () => {
    const cells = parseLine('\x1b[1;2mA\x1b[22mB');
    expect(cells[0].style.bold).toBe(true);
    expect(cells[0].style.dim).toBe(true);
    expect(cells[1].style.bold).toBe(false);
    expect(cells[1].style.dim).toBe(false);
  });
});

describe('cellsToAnsi', () => {
  it('emits an empty string for empty input', () => {
    expect(cellsToAnsi([])).toBe('');
  });

  it('emits plain text without SGR when the style is default', () => {
    const cells = parseLine('abc');
    expect(cellsToAnsi(cells)).toBe('abc');
  });

  it('emits SGR for a non-default style and a final reset', () => {
    const cells = parseLine('\x1b[31mabc');
    expect(cellsToAnsi(cells)).toBe('\x1b[31mabc\x1b[0m');
  });

  it('merges runs with identical style', () => {
    const cells = parseLine('\x1b[1mABC');
    const out = cellsToAnsi(cells);
    expect(out).toBe('\x1b[1mABC\x1b[0m');
  });

  it('round-trips truecolor', () => {
    const input = '\x1b[38;2;10;20;30mX';
    const parsed = parseLine(input);
    const out = cellsToAnsi(parsed);
    expect(out).toContain('38;2;10;20;30');
    expect(out).toContain('X');
  });

  it('skips continuation cells', () => {
    const cells = parseLine('日');
    const out = cellsToAnsi(cells);
    expect(out.includes('日')).toBe(true);
  });
});
