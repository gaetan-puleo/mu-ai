import { test, expect } from 'vitest';
import { cellsToAnsi } from './ansi';
import { type Cell, defaultStyle } from './cell';
import { bufferUsedHeight, type CellBuffer, createCellBuffer, diffBuffer } from './cellbuffer';

const put = (buf: CellBuffer, x: number, y: number, grapheme: string): void => {
  const cell: Cell = { grapheme, width: 1, style: defaultStyle() };
  buf.cells[y * buf.width + x] = cell;
};

const text = (buf: CellBuffer, x: number, y: number, value: string): void => {
  for (let i = 0; i < value.length; i++) put(buf, x + i, y, value[i]);
};

test('a single changed character -> a single one-cell run', () => {
  const a = createCellBuffer(20, 3);
  const b = createCellBuffer(20, 3);
  text(a, 0, 0, 'hello');
  text(b, 0, 0, 'hello');
  put(b, 4, 0, 'p');

  const runs = diffBuffer(a, b, 3);
  expect(runs.length).toEqual(1);
  expect(runs[0].y).toEqual(0);
  expect(runs[0].x).toEqual(4);
  expect(runs[0].cells.length).toEqual(1);
  expect(runs[0].cells[0].grapheme).toEqual('p');
});

test('character appended at end of line -> one run, not the whole line', () => {
  const a = createCellBuffer(20, 1);
  const b = createCellBuffer(20, 1);
  text(a, 0, 0, 'hello');
  text(b, 0, 0, 'hello');
  put(b, 5, 0, '!');

  const runs = diffBuffer(a, b, 1);
  expect(runs.length).toEqual(1);
  expect(runs[0].x).toEqual(5);
  expect(cellsToAnsi(runs[0].cells).includes('!')).toEqual(true);
});

test('nearby changes merged into a single run', () => {
  const a = createCellBuffer(20, 1);
  const b = createCellBuffer(20, 1);
  text(a, 0, 0, 'aXbXc');
  text(b, 0, 0, 'aYbYc');

  const runs = diffBuffer(a, b, 1);
  expect(runs.length).toEqual(1);
  expect(runs[0].x).toEqual(1);
  expect(runs[0].cells.length).toEqual(3);
});

test('distant changes -> two separate runs', () => {
  const a = createCellBuffer(80, 1);
  const b = createCellBuffer(80, 1);
  put(a, 0, 0, 'a');
  put(b, 0, 0, 'b');
  put(a, 79, 0, 'y');
  put(b, 79, 0, 'z');

  const runs = diffBuffer(a, b, 1);
  expect(runs.length).toEqual(2);
  expect(runs[0].x).toEqual(0);
  expect(runs[1].x).toEqual(79);
});

test('cleared line -> single clear run', () => {
  const a = createCellBuffer(20, 2);
  const b = createCellBuffer(20, 2);
  text(a, 0, 1, 'gone');

  const runs = diffBuffer(a, b, 2);
  expect(runs.length).toEqual(1);
  expect(runs[0].clear).toEqual(true);
  expect(runs[0].y).toEqual(1);
});

test('no changes -> no runs', () => {
  const a = createCellBuffer(10, 2);
  const b = createCellBuffer(10, 2);
  text(a, 0, 0, 'same');
  text(b, 0, 0, 'same');
  expect(diffBuffer(a, b, 2).length).toEqual(0);
});

test('bufferUsedHeight ignores empty trailing lines', () => {
  const buf = createCellBuffer(10, 5);
  text(buf, 0, 1, 'x');
  expect(bufferUsedHeight(buf)).toEqual(2);
});
