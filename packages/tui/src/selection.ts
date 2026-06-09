import type { CellBuffer } from './layout/cellbuffer';

export interface Point {
  x: number;
  y: number;
}

export function orderPoints(anchor: Point, head: Point): { start: Point; end: Point } {
  const headFirst = head.y < anchor.y || (head.y === anchor.y && head.x < anchor.x);
  return headFirst ? { start: head, end: anchor } : { start: anchor, end: head };
}

function rowBounds(buffer: CellBuffer, y: number, start: Point, end: Point): [number, number] {
  const xStart = y === start.y ? start.x : 0;
  const xEnd = y === end.y ? end.x : buffer.width - 1;
  return [Math.max(0, xStart), Math.min(buffer.width - 1, xEnd)];
}

export function selectedText(buffer: CellBuffer, start: Point, end: Point): string {
  const lines: string[] = [];
  for (let y = Math.max(0, start.y); y <= Math.min(buffer.height - 1, end.y); y++) {
    const [x0, x1] = rowBounds(buffer, y, start, end);
    let line = '';
    for (let x = x0; x <= x1; x++) {
      const cell = buffer.cells[y * buffer.width + x];
      if (!cell || cell.width === 0) continue;
      line += cell.grapheme || ' ';
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}

export function highlightSelection(buffer: CellBuffer, start: Point, end: Point): void {
  for (let y = Math.max(0, start.y); y <= Math.min(buffer.height - 1, end.y); y++) {
    const [x0, x1] = rowBounds(buffer, y, start, end);
    for (let x = x0; x <= x1; x++) {
      const cell = buffer.cells[y * buffer.width + x];
      if (cell) cell.style = { ...cell.style, reverse: true };
    }
  }
}
