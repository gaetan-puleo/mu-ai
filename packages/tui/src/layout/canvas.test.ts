import { describe, expect, it } from 'vitest';

import { canvasToLines, createCanvas, drawBorder, drawLines } from './canvas';

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
});
