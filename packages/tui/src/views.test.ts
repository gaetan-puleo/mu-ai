import { test, expect } from 'vitest';
import { cellBufferToLines, createCellBuffer, getCell } from './layout/cellbuffer';
import { type Component, measure, renderToBuffer } from './surface';
import { scrollView } from './components/scroll-view';
import { box, column, flex, overlay, row, text } from './views';

const stripAnsi = (line: string): string => line.replace(/\[[0-9;]*m/g, '').replace(/\]8;;[^]*/g, '').trimEnd();
const lines = (buf: ReturnType<typeof createCellBuffer>): string[] => cellBufferToLines(buf).map(stripAnsi);
const greenFill: Component = { render: (s) => s.fill({ x: 0, y: 0, width: s.width, height: s.height }, '#00ff00') };

test('fill alpha blends with the backdrop (compositing preserved)', () => {
  const buf = createCellBuffer(6, 1);
  renderToBuffer(box(text(''), { background: '#ff0000', backgroundOpacity: 0.5 }), buf);
  const bg = getCell(buf, 0, 0).style.bg;
  expect(bg.r > 110 && bg.r < 145).toEqual(true);
  expect(bg.g).toEqual(0);
  expect(bg.b).toEqual(0);
});

test('column derives the height of each child (probe-based measure)', () => {
  const buf = createCellBuffer(10, 4);
  renderToBuffer(column([text('one\ntwo'), text('three')]), buf);
  const out = lines(buf);
  expect(out[0]).toEqual('one');
  expect(out[1]).toEqual('two');
  expect(out[2]).toEqual('three');
});

test('column distributes the remaining space to flex children', () => {
  const buf = createCellBuffer(6, 5);
  renderToBuffer(column([text('top'), flex(greenFill), text('bot')]), buf);
  const out = lines(buf);
  expect(out[0]).toEqual('top');
  expect(out[4]).toEqual('bot');
  expect(getCell(buf, 0, 2).style.bg.g).toEqual(255);
});

test('box offsets the content according to the border', () => {
  const buf = createCellBuffer(8, 3);
  renderToBuffer(box(text('x'), { border: true }), buf);
  expect(getCell(buf, 0, 0).grapheme).toEqual('┌');
  expect(getCell(buf, 1, 1).grapheme).toEqual('x');
});

test('overlay dims the background with alpha and places the panel', () => {
  const buf = createCellBuffer(20, 6);
  renderToBuffer(overlay(greenFill, box(text('modal'), { background: '#222222' }), { width: 10, opacity: 0.6 }), buf);
  const corner = getCell(buf, 0, 0).style.bg;
  expect(corner.g > 80 && corner.g < 130).toEqual(true);
  expect(corner.a >= 1).toEqual(true);
});

test('row: auto child (measured width) + flex share the width', () => {
  const buf = createCellBuffer(20, 1);
  renderToBuffer(row([text('ab'), flex(greenFill)]), buf);
  expect(getCell(buf, 0, 0).grapheme).toEqual('a');
  expect(getCell(buf, 1, 0).grapheme).toEqual('b');
  expect(getCell(buf, 2, 0).style.bg.g).toEqual(255);
  expect(getCell(buf, 19, 0).style.bg.g).toEqual(255);
});

test('scrollView sticks to the bottom when the content overflows', () => {
  const buf = createCellBuffer(10, 3);
  const tall = column([text('a'), text('b'), text('c'), text('d'), text('e'), text('f')]);
  renderToBuffer(scrollView(tall), buf);
  const out = lines(buf);
  expect(out[2]).toEqual('f');
  expect(out[1]).toEqual('e');
});

test('measure: intrinsic height without drawing', () => {
  expect(measure(text('a\nb\nc'), 10)).toEqual(3);
});
