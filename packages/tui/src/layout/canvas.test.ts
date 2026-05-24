import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';

import { stripAnsi, visibleWidth } from '../utils';
import { canvasToLines, createCanvas, drawBackground, drawBorder, drawLines } from './canvas';

const fullClip = { x: 0, y: 0, width: 10, height: 5 };

describe('canvas', () => {
  it('initializes with blank rows', () => {
    const canvas = createCanvas(10, 3);
    expect(canvasToLines(canvas)).toEqual(['          ', '          ', '          ']);
  });

  it('draws text at a position', () => {
    const canvas = createCanvas(10, 3);
    drawLines(canvas, 2, 1, ['abc'], fullClip);
    expect(canvasToLines(canvas)[1]).toBe('  abc     ');
  });

  it('clips horizontally to clip rect', () => {
    const canvas = createCanvas(10, 1);
    drawLines(canvas, 0, 0, ['abcdefghij'], { x: 2, y: 0, width: 4, height: 1 });
    expect(canvasToLines(canvas)[0]).toBe('  cdef    ');
  });

  it('clips vertically to clip rect', () => {
    const canvas = createCanvas(10, 4);
    drawLines(canvas, 0, 0, ['line0', 'line1', 'line2', 'line3'], { x: 0, y: 1, width: 10, height: 2 });
    expect(canvasToLines(canvas)).toEqual(['          ', 'line1     ', 'line2     ', '          ']);
  });

  it('draws a full border with default characters', () => {
    const canvas = createCanvas(6, 4);
    drawBorder(canvas, { x: 0, y: 0, width: 6, height: 4 }, true, { x: 0, y: 0, width: 6, height: 4 });
    expect(canvasToLines(canvas)).toEqual([
      '\u250C\u2500\u2500\u2500\u2500\u2510',
      '\u2502    \u2502',
      '\u2502    \u2502',
      '\u2514\u2500\u2500\u2500\u2500\u2518',
    ]);
  });

  it('does not draw outside canvas bounds', () => {
    const canvas = createCanvas(5, 1);
    drawLines(canvas, 100, 0, ['abc'], fullClip);
    drawLines(canvas, 0, 100, ['def'], fullClip);
    expect(canvasToLines(canvas)).toEqual(['     ']);
  });

  it('draws hex backgrounds', () => {
    const canvas = createCanvas(4, 1);
    drawBackground(canvas, { x: 0, y: 0, width: 4, height: 1 }, '#1a2b3c', { x: 0, y: 0, width: 4, height: 1 });
    const line = canvasToLines(canvas)[0];
    expect(line).toContain('\x1b[48;2;26;43;60m');
    expect(stripAnsi(line)).toBe('    ');
    expect(visibleWidth(line)).toBe(4);
  });

  it('draws shorthand hex backgrounds', () => {
    const canvas = createCanvas(2, 1);
    drawBackground(canvas, { x: 0, y: 0, width: 2, height: 1 }, '#abc', { x: 0, y: 0, width: 2, height: 1 });
    expect(canvasToLines(canvas)[0]).toContain('\x1b[48;2;170;187;204m');
  });

  it('draws named backgrounds', () => {
    const canvas = createCanvas(3, 1);
    drawBackground(canvas, { x: 0, y: 0, width: 3, height: 1 }, 'brightBlue', { x: 0, y: 0, width: 3, height: 1 });
    expect(canvasToLines(canvas)[0]).toContain('\x1b[104m');
  });

  it('clips backgrounds', () => {
    const canvas = createCanvas(6, 1);
    drawBackground(canvas, { x: 0, y: 0, width: 6, height: 1 }, 'red', { x: 2, y: 0, width: 2, height: 1 });
    const line = canvasToLines(canvas)[0];
    expect(stripAnsi(line)).toBe('      ');
    expect(line).toContain('  \x1b[41m  \x1b[0m  ');
  });

  it('does not draw a wide character into a one-column right-edge clip', () => {
    const canvas = createCanvas(4, 1);
    drawLines(canvas, 3, 0, ['你'], { x: 3, y: 0, width: 1, height: 1 });

    const line = canvasToLines(canvas)[0];
    expect(stripAnsi(line)).toBe('    ');
    expect(visibleWidth(line)).toBe(4);
  });
});
