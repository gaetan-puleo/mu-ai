import { assertEquals } from '@std/assert';
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

Deno.test('a single changed character -> a single one-cell run', () => {
  const a = createCellBuffer(20, 3);
  const b = createCellBuffer(20, 3);
  text(a, 0, 0, 'hello');
  text(b, 0, 0, 'hello');
  put(b, 4, 0, 'p');

  const runs = diffBuffer(a, b, 3);
  assertEquals(runs.length, 1);
  assertEquals(runs[0].y, 0);
  assertEquals(runs[0].x, 4);
  assertEquals(runs[0].cells.length, 1);
  assertEquals(runs[0].cells[0].grapheme, 'p');
});

Deno.test('character appended at end of line -> one run, not the whole line', () => {
  const a = createCellBuffer(20, 1);
  const b = createCellBuffer(20, 1);
  text(a, 0, 0, 'hello');
  text(b, 0, 0, 'hello');
  put(b, 5, 0, '!');

  const runs = diffBuffer(a, b, 1);
  assertEquals(runs.length, 1);
  assertEquals(runs[0].x, 5);
  assertEquals(cellsToAnsi(runs[0].cells).includes('!'), true);
});

Deno.test('nearby changes merged into a single run', () => {
  const a = createCellBuffer(20, 1);
  const b = createCellBuffer(20, 1);
  text(a, 0, 0, 'aXbXc');
  text(b, 0, 0, 'aYbYc');

  const runs = diffBuffer(a, b, 1);
  assertEquals(runs.length, 1);
  assertEquals(runs[0].x, 1);
  assertEquals(runs[0].cells.length, 3);
});

Deno.test('distant changes -> two separate runs', () => {
  const a = createCellBuffer(80, 1);
  const b = createCellBuffer(80, 1);
  put(a, 0, 0, 'a');
  put(b, 0, 0, 'b');
  put(a, 79, 0, 'y');
  put(b, 79, 0, 'z');

  const runs = diffBuffer(a, b, 1);
  assertEquals(runs.length, 2);
  assertEquals(runs[0].x, 0);
  assertEquals(runs[1].x, 79);
});

Deno.test('cleared line -> single clear run', () => {
  const a = createCellBuffer(20, 2);
  const b = createCellBuffer(20, 2);
  text(a, 0, 1, 'gone');

  const runs = diffBuffer(a, b, 2);
  assertEquals(runs.length, 1);
  assertEquals(runs[0].clear, true);
  assertEquals(runs[0].y, 1);
});

Deno.test('no changes -> no runs', () => {
  const a = createCellBuffer(10, 2);
  const b = createCellBuffer(10, 2);
  text(a, 0, 0, 'same');
  text(b, 0, 0, 'same');
  assertEquals(diffBuffer(a, b, 2).length, 0);
});

Deno.test('bufferUsedHeight ignores empty trailing lines', () => {
  const buf = createCellBuffer(10, 5);
  text(buf, 0, 1, 'x');
  assertEquals(bufferUsedHeight(buf), 2);
});
