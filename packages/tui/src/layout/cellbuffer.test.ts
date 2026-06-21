import { describe, expect, it } from 'vitest';

import { parseLine } from './ansi';
import {
  cellBufferToLines,
  createCellBuffer,
  drawBorderCells,
  fillBackground,
  popOpacity,
  pushOpacity,
  writeCells,
} from './cellbuffer';
import { colorToRgba, rgbColor } from './color';

const fullClip = { x: 0, y: 0, width: 10, height: 4 };

describe('cellbuffer', () => {
  it('initializes empty lines made of spaces', () => {
    const buf = createCellBuffer(4, 2);
    const lines = cellBufferToLines(buf);
    expect(lines).toHaveLength(2);
    expect(lines[0].includes('    ')).toBe(true);
  });

  it('writes parsed cells into the buffer', () => {
    const buf = createCellBuffer(10, 1);
    writeCells(buf, 2, 0, parseLine('abc'), fullClip);
    const out = cellBufferToLines(buf)[0];
    expect(out).toContain('abc');
  });

  it('respects the horizontal clip', () => {
    const buf = createCellBuffer(10, 1);
    writeCells(buf, 0, 0, parseLine('abcdefghij'), { x: 2, y: 0, width: 4, height: 1 });
    const out = cellBufferToLines(buf)[0];
    expect(out).toContain('cdef');
    expect(out).not.toContain('a');
    expect(out).not.toContain('j');
  });

  it('respects the vertical clip (ignores out-of-range lines)', () => {
    const buf = createCellBuffer(4, 3);
    writeCells(buf, 0, 0, parseLine('XXXX'), { x: 0, y: 1, width: 4, height: 2 });
    const lines = cellBufferToLines(buf);
    expect(lines[0]).not.toContain('X');
  });

  it('fillBackground on default cells uses the backdrop as the base', () => {
    const buf = createCellBuffer(4, 1, rgbColor(0, 0, 0));
    fillBackground(buf, { x: 0, y: 0, width: 4, height: 1 }, rgbColor(255, 0, 0), fullClip);
    const out = cellBufferToLines(buf)[0];
    expect(out).toContain('48;2;255;0;0');
  });

  it('blends a semi-transparent bg over an underlying opaque bg', () => {
    const buf = createCellBuffer(4, 1, rgbColor(0, 0, 0));
    fillBackground(buf, { x: 0, y: 0, width: 4, height: 1 }, rgbColor(0, 0, 255), fullClip);
    fillBackground(buf, { x: 0, y: 0, width: 4, height: 1 }, { ...rgbColor(255, 0, 0), a: 0.5 }, fullClip);
    const out = cellBufferToLines(buf)[0];
    expect(out).toContain('48;2;128;0;128');
  });

  it('preserves the underlying glyph when overlaying a transparent space', () => {
    const buf = createCellBuffer(4, 1, rgbColor(0, 0, 0));
    writeCells(buf, 0, 0, parseLine('abcd'), fullClip);
    const spaceWithBg: ReturnType<typeof parseLine> = parseLine('\x1b[48;2;255;0;0m    ').map(
      (c) => ({ ...c, style: { ...c.style, bg: { ...c.style.bg, a: 0.5 } } }),
    );
    writeCells(buf, 0, 0, spaceWithBg, fullClip);
    const out = cellBufferToLines(buf)[0];
    expect(out).toContain('a');
    expect(out).toContain('b');
    expect(out).toContain('c');
    expect(out).toContain('d');
    expect(out).toContain('48;2;128;0;0');
  });

  it('the opacity stack multiplies opacities for fillBackground', () => {
    const buf = createCellBuffer(2, 1, rgbColor(0, 0, 0));
    pushOpacity(buf, 0.5);
    pushOpacity(buf, 0.5);
    fillBackground(buf, { x: 0, y: 0, width: 2, height: 1 }, rgbColor(255, 0, 0), fullClip);
    popOpacity(buf);
    popOpacity(buf);
    const out = cellBufferToLines(buf)[0];
    expect(out).toContain('48;2;64;0;0');
  });

  it('draws a border', () => {
    const buf = createCellBuffer(6, 4);
    drawBorderCells(buf, { x: 0, y: 0, width: 6, height: 4 }, true, { x: 0, y: 0, width: 6, height: 4 });
    const lines = cellBufferToLines(buf);
    expect(lines[0]).toContain('┌');
    expect(lines[0]).toContain('┐');
    expect(lines[3]).toContain('└');
    expect(lines[3]).toContain('┘');
  });

  it('the backdrop defaults to opaque black when unspecified', () => {
    const buf = createCellBuffer(2, 1);
    expect(buf.backdropColor.a).toBe(1);
  });

  it('a named colorToRgba color round-trips through the buffer', () => {
    const buf = createCellBuffer(2, 1, rgbColor(0, 0, 0));
    fillBackground(buf, { x: 0, y: 0, width: 2, height: 1 }, colorToRgba('red'), fullClip);
    const out = cellBufferToLines(buf)[0];
    expect(out).toContain('41');
  });

  it('end to end: a semi-transparent modal-style overlay dims the content beneath', () => {
    const buf = createCellBuffer(10, 1, rgbColor(0, 0, 0));
    writeCells(buf, 0, 0, parseLine('\x1b[48;2;0;200;200mTEXT      '), fullClip);
    fillBackground(buf, { x: 0, y: 0, width: 10, height: 1 }, { ...rgbColor(0, 0, 0), a: 0.5 }, fullClip);
    const out = cellBufferToLines(buf)[0];
    expect(out).toContain('48;2;0;100;100');
    expect(out).toContain('T');
    expect(out).toContain('E');
  });

  it('end to end: an opaque panel sits on top of a dimmed backdrop', () => {
    const buf = createCellBuffer(10, 1, rgbColor(0, 0, 0));
    writeCells(buf, 0, 0, parseLine('\x1b[48;2;0;200;200m          '), fullClip);
    fillBackground(buf, { x: 0, y: 0, width: 10, height: 1 }, { ...rgbColor(0, 0, 0), a: 0.5 }, fullClip);
    writeCells(buf, 0, 0, parseLine('   \x1b[48;2;30;30;30mPANEL\x1b[0m  '), fullClip);
    const out = cellBufferToLines(buf)[0];
    expect(out).toContain('48;2;0;100;100');
    expect(out).toContain('48;2;30;30;30');
    expect(out).toContain('PANEL');
  });
});
