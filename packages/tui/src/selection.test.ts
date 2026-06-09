import { assertEquals } from '@std/assert';
import { type CellBuffer, createCellBuffer } from './layout/cellbuffer';
import { orderPoints, selectedText } from './selection';

function paint(text: string, width = 10, height = 3): CellBuffer {
  const buf = createCellBuffer(width, height);
  const rows = text.split('\n');
  for (let y = 0; y < rows.length && y < height; y++) {
    for (let x = 0; x < rows[y].length && x < width; x++) {
      buf.cells[y * width + x] = { grapheme: rows[y][x], width: 1, style: buf.cells[0].style };
    }
  }
  return buf;
}

Deno.test('selectedText extracts a single-line span inclusive of the end cell', () => {
  const buf = paint('hello world');
  assertEquals(selectedText(buf, { x: 0, y: 0 }, { x: 4, y: 0 }), 'hello');
});

Deno.test('selectedText spans multiple rows and trims trailing whitespace', () => {
  const buf = paint('abc\ndefgh\nij');
  const { start, end } = orderPoints({ x: 1, y: 0 }, { x: 2, y: 2 });
  assertEquals(selectedText(buf, start, end), 'bc\ndefgh\nij');
});

Deno.test('orderPoints normalizes a reversed (bottom-up) drag', () => {
  const a = { x: 5, y: 2 };
  const b = { x: 1, y: 0 };
  assertEquals(orderPoints(a, b), { start: b, end: a });
});

Deno.test('selectedText skips width-0 continuation cells', () => {
  const buf = createCellBuffer(6, 1);
  buf.cells[0] = { grapheme: '世', width: 2, style: buf.cells[0].style };
  buf.cells[1] = { grapheme: '', width: 0, style: buf.cells[0].style };
  buf.cells[2] = { grapheme: 'x', width: 1, style: buf.cells[0].style };
  assertEquals(selectedText(buf, { x: 0, y: 0 }, { x: 2, y: 0 }), '世x');
});
