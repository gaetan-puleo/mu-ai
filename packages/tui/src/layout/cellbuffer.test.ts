import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';

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
  it('initializes blank rows of spaces', () => {
    const buf = createCellBuffer(4, 2);
    const lines = cellBufferToLines(buf);
    expect(lines).toHaveLength(2);
    // Default cells: spaces with transparent bg → backdrop. No visible style.
    expect(lines[0].includes('    ')).toBe(true);
  });

  it('writes parsed cells onto the buffer', () => {
    const buf = createCellBuffer(10, 1);
    writeCells(buf, 2, 0, parseLine('abc'), fullClip);
    const out = cellBufferToLines(buf)[0];
    expect(out).toContain('abc');
  });

  it('respects horizontal clip', () => {
    const buf = createCellBuffer(10, 1);
    writeCells(buf, 0, 0, parseLine('abcdefghij'), { x: 2, y: 0, width: 4, height: 1 });
    const out = cellBufferToLines(buf)[0];
    expect(out).toContain('cdef');
    expect(out).not.toContain('a');
    expect(out).not.toContain('j');
  });

  it('respects vertical clip (drops out-of-range rows)', () => {
    const buf = createCellBuffer(4, 3);
    writeCells(buf, 0, 0, parseLine('XXXX'), { x: 0, y: 1, width: 4, height: 2 });
    const lines = cellBufferToLines(buf);
    expect(lines[0]).not.toContain('X');
  });

  it('fillBackground over default cells uses backdrop as base', () => {
    const buf = createCellBuffer(4, 1, rgbColor(0, 0, 0));
    fillBackground(buf, { x: 0, y: 0, width: 4, height: 1 }, rgbColor(255, 0, 0), fullClip);
    const out = cellBufferToLines(buf)[0];
    // Should emit a red background (48;2;255;0;0) somewhere in the line.
    expect(out).toContain('48;2;255;0;0');
  });

  it('blends a semi-transparent bg over an opaque underlying bg', () => {
    const buf = createCellBuffer(4, 1, rgbColor(0, 0, 0));
    // First fill: solid blue.
    fillBackground(buf, { x: 0, y: 0, width: 4, height: 1 }, rgbColor(0, 0, 255), fullClip);
    // Second fill: 50% red — should blend to ~ (128, 0, 128).
    fillBackground(buf, { x: 0, y: 0, width: 4, height: 1 }, { ...rgbColor(255, 0, 0), a: 0.5 }, fullClip);
    const out = cellBufferToLines(buf)[0];
    expect(out).toContain('48;2;128;0;128');
  });

  it('preserves underlying glyph when overlaying a transparent space', () => {
    const buf = createCellBuffer(4, 1, rgbColor(0, 0, 0));
    writeCells(buf, 0, 0, parseLine('abcd'), fullClip);
    // Overlay a half-transparent red bg as spaces; the letters should still show.
    const spaceWithBg: ReturnType<typeof parseLine> = parseLine('\x1b[48;2;255;0;0m    ').map(
      (c) => ({ ...c, style: { ...c.style, bg: { ...c.style.bg, a: 0.5 } } }),
    );
    writeCells(buf, 0, 0, spaceWithBg, fullClip);
    const out = cellBufferToLines(buf)[0];
    // Letters preserved despite the overlay
    expect(out).toContain('a');
    expect(out).toContain('b');
    expect(out).toContain('c');
    expect(out).toContain('d');
    // Background blended into ~ (128, 0, 0)
    expect(out).toContain('48;2;128;0;0');
  });

  it('opacity stack multiplies opacities for fillBackground', () => {
    const buf = createCellBuffer(2, 1, rgbColor(0, 0, 0));
    pushOpacity(buf, 0.5);
    pushOpacity(buf, 0.5);
    fillBackground(buf, { x: 0, y: 0, width: 2, height: 1 }, rgbColor(255, 0, 0), fullClip);
    popOpacity(buf);
    popOpacity(buf);
    const out = cellBufferToLines(buf)[0];
    // 0.5 * 0.5 = 0.25 red over black → ~64
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

  it('backdrop defaults to opaque black if not specified', () => {
    const buf = createCellBuffer(2, 1);
    expect(buf.backdropColor.a).toBe(1);
  });

  it('colorToRgba named color round-trips through the buffer', () => {
    const buf = createCellBuffer(2, 1, rgbColor(0, 0, 0));
    fillBackground(buf, { x: 0, y: 0, width: 2, height: 1 }, colorToRgba('red'), fullClip);
    const out = cellBufferToLines(buf)[0];
    // Named color → indexed → emitted as '41'
    expect(out).toContain('41');
  });

  it('end-to-end: modal-style semi-transparent overlay darkens content beneath it', () => {
    const buf = createCellBuffer(10, 1, rgbColor(0, 0, 0));
    // Underneath: bright cyan text.
    writeCells(buf, 0, 0, parseLine('\x1b[48;2;0;200;200mTEXT      '), fullClip);
    // Overlay: 50% black bg as a backdrop.
    fillBackground(buf, { x: 0, y: 0, width: 10, height: 1 }, { ...rgbColor(0, 0, 0), a: 0.5 }, fullClip);
    const out = cellBufferToLines(buf)[0];
    // Cyan was (0, 200, 200); 50% black over it → (0, 100, 100).
    expect(out).toContain('48;2;0;100;100');
    // The text characters remain visible.
    expect(out).toContain('T');
    expect(out).toContain('E');
  });

  it('end-to-end: opaque panel sits on top of dimmed backdrop', () => {
    const buf = createCellBuffer(10, 1, rgbColor(0, 0, 0));
    // Underneath cyan
    writeCells(buf, 0, 0, parseLine('\x1b[48;2;0;200;200m          '), fullClip);
    // Backdrop dim
    fillBackground(buf, { x: 0, y: 0, width: 10, height: 1 }, { ...rgbColor(0, 0, 0), a: 0.5 }, fullClip);
    // Panel rows: leading spaces (preserve backdrop) + opaque panel chars.
    writeCells(buf, 0, 0, parseLine('   \x1b[48;2;30;30;30mPANEL\x1b[0m  '), fullClip);
    const out = cellBufferToLines(buf)[0];
    // Backdrop should be visible (dimmed cyan) where the leading spaces are.
    expect(out).toContain('48;2;0;100;100');
    // Panel chars should have the panel bg.
    expect(out).toContain('48;2;30;30;30');
    expect(out).toContain('PANEL');
  });
});
