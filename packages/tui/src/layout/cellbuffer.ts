import { cellsToAnsi } from './ansi';
import { type Cell, cellEqual, type CellStyle, continuationCell, defaultStyle, emptyCell } from './cell';
import { blendOver, OPAQUE_BLACK, type Rgba, withOpacity } from './color';
import { intersectRect, isEmptyRect } from './insets';
import type { BorderStyle, Rect } from './types';
import { DEFAULT_BORDER_CHARS } from './types';

export interface CellBuffer {
  width: number;
  height: number;
  cells: Cell[];
  backdropColor: Rgba;
  opacityStack: number[];
}

export function createCellBuffer(width: number, height: number, backdropColor?: Rgba): CellBuffer {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const cells: Cell[] = new Array(w * h);
  for (let i = 0; i < cells.length; i++) cells[i] = emptyCell();
  return {
    width: w,
    height: h,
    cells,
    backdropColor: backdropColor ?? OPAQUE_BLACK,
    opacityStack: [],
  };
}

export function setBackdropColor(buf: CellBuffer, color: Rgba): void {
  buf.backdropColor = { ...color, a: 1 };
}

export function pushOpacity(buf: CellBuffer, opacity: number): void {
  buf.opacityStack.push(Math.max(0, Math.min(1, opacity)));
}

export function popOpacity(buf: CellBuffer): void {
  buf.opacityStack.pop();
}

export function effectiveOpacity(buf: CellBuffer): number {
  let o = 1;
  for (const v of buf.opacityStack) o *= v;
  return o;
}

function bufferRect(buf: CellBuffer): Rect {
  return { x: 0, y: 0, width: buf.width, height: buf.height };
}

function hasDecoration(style: CellStyle): boolean {
  return style.reverse || style.underline || style.bold || style.italic || style.dim ||
    style.strikethrough || style.blink || style.link !== undefined;
}

function getIndex(buf: CellBuffer, x: number, y: number): number {
  return y * buf.width + x;
}

export function getCell(buf: CellBuffer, x: number, y: number): Cell {
  return buf.cells[getIndex(buf, x, y)];
}

export function compositeCell(buf: CellBuffer, x: number, y: number, incoming: Cell, opacity = 1): void {
  if (x < 0 || x >= buf.width || y < 0 || y >= buf.height) return;
  if (incoming.width === 0) return;

  const existing = buf.cells[getIndex(buf, x, y)];
  const incomingBg = opacity < 1 ? withOpacity(incoming.style.bg, opacity) : incoming.style.bg;
  const incomingFg = opacity < 1 ? withOpacity(incoming.style.fg, opacity) : incoming.style.fg;

  let newBg: Rgba;
  if (incomingBg.a <= 0) {
    newBg = existing.style.bg;
  } else if (incomingBg.a >= 1) {
    newBg = incomingBg;
  } else {
    const baseBg = existing.style.bg.a <= 0 ? buf.backdropColor : existing.style.bg;
    newBg = blendOver(incomingBg, baseBg);
  }

  const isTransparentSpace = incoming.grapheme === ' ' && incomingBg.a < 1 && !hasDecoration(incoming.style);
  if (isTransparentSpace) {
    existing.style = { ...existing.style, bg: newBg };
    return;
  }

  const newStyle: CellStyle = {
    ...incoming.style,
    fg: incomingFg,
    bg: newBg,
  };
  buf.cells[getIndex(buf, x, y)] = {
    grapheme: incoming.grapheme,
    width: incoming.width,
    style: newStyle,
  };

  if (incoming.width === 2 && x + 1 < buf.width) {
    const cont = continuationCell();
    cont.style = newStyle;
    buf.cells[getIndex(buf, x + 1, y)] = cont;
  }
}

export function fillBackground(buf: CellBuffer, rect: Rect, color: Rgba, clip: Rect): void {
  if (color.a <= 0) return;
  const opacity = effectiveOpacity(buf);
  const tinted = opacity < 1 ? withOpacity(color, opacity) : color;
  if (tinted.a <= 0) return;

  const safe = intersectRect(intersectRect(rect, clip), bufferRect(buf));
  if (isEmptyRect(safe)) return;

  for (let y = safe.y; y < safe.y + safe.height; y++) {
    for (let x = safe.x; x < safe.x + safe.width; x++) {
      const cell = buf.cells[getIndex(buf, x, y)];
      const baseBg = cell.style.bg.a <= 0 ? buf.backdropColor : cell.style.bg;
      cell.style = { ...cell.style, bg: blendOver(tinted, baseBg) };
    }
  }
}

export function clearBackground(buf: CellBuffer, rect: Rect, color: Rgba, clip: Rect): void {
  if (color.a < 1 || effectiveOpacity(buf) < 1) {
    fillBackground(buf, rect, color, clip);
    return;
  }
  const safe = intersectRect(intersectRect(rect, clip), bufferRect(buf));
  if (isEmptyRect(safe)) return;
  for (let y = safe.y; y < safe.y + safe.height; y++) {
    for (let x = safe.x; x < safe.x + safe.width; x++) {
      buf.cells[getIndex(buf, x, y)] = { grapheme: ' ', width: 1, style: { ...defaultStyle(), bg: color } };
    }
  }
}

export function writeCells(buf: CellBuffer, x: number, y: number, cells: Cell[], clip: Rect): void {
  if (cells.length === 0) return;
  const safe = intersectRect(clip, bufferRect(buf));
  if (isEmptyRect(safe)) return;
  if (y < safe.y || y >= safe.y + safe.height) return;

  const opacity = effectiveOpacity(buf);
  let col = x;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.width === 0) continue;

    if (col >= safe.x + safe.width) break;

    if (cell.width === 2) {
      if (col + 1 >= safe.x + safe.width || col < safe.x) {
        if (col >= safe.x && col < safe.x + safe.width) {
          const sub: Cell = {
            grapheme: ' ',
            width: 1,
            style: cell.style,
          };
          compositeCell(buf, col, y, sub, opacity);
        }
        col += cell.width;
        continue;
      }
    }

    if (col >= safe.x) {
      compositeCell(buf, col, y, cell, opacity);
    }
    col += cell.width;
  }
}

export function drawBorderCells(buf: CellBuffer, rect: Rect, style: BorderStyle | true, clip: Rect): void {
  if (rect.width <= 0 || rect.height <= 0) return;
  const safe = intersectRect(clip, bufferRect(buf));
  if (isEmptyRect(safe)) return;

  const resolved = resolveBorder(style);
  const chars = resolved.chars;

  const top = rect.y;
  const bottom = rect.y + rect.height - 1;
  const left = rect.x;
  const right = rect.x + rect.width - 1;

  const drawAt = (x: number, y: number, grapheme: string): void => {
    if (x < safe.x || x >= safe.x + safe.width) return;
    if (y < safe.y || y >= safe.y + safe.height) return;
    const cell: Cell = { grapheme, width: 1, style: defaultStyle() };
    compositeCell(buf, x, y, cell);
  };

  if (resolved.top && rect.height >= 1) {
    for (let x = left; x <= right; x++) {
      let ch = chars.horizontal;
      if (x === left && resolved.left) ch = chars.topLeft;
      else if (x === right && resolved.right) ch = chars.topRight;
      drawAt(x, top, ch);
    }
  }
  if (resolved.bottom && rect.height >= 2) {
    for (let x = left; x <= right; x++) {
      let ch = chars.horizontal;
      if (x === left && resolved.left) ch = chars.bottomLeft;
      else if (x === right && resolved.right) ch = chars.bottomRight;
      drawAt(x, bottom, ch);
    }
  }
  if (resolved.left && rect.width >= 1) {
    const startY = resolved.top ? top + 1 : top;
    const endY = resolved.bottom ? bottom - 1 : bottom;
    for (let y = startY; y <= endY; y++) drawAt(left, y, chars.vertical);
  }
  if (resolved.right && rect.width >= 2) {
    const startY = resolved.top ? top + 1 : top;
    const endY = resolved.bottom ? bottom - 1 : bottom;
    for (let y = startY; y <= endY; y++) drawAt(right, y, chars.vertical);
  }
}

export function cellBufferToLines(buf: CellBuffer): string[] {
  const lines: string[] = new Array(buf.height);
  for (let y = 0; y < buf.height; y++) {
    const row = new Array<Cell>(buf.width);
    for (let x = 0; x < buf.width; x++) {
      row[x] = finalizeCell(buf, buf.cells[getIndex(buf, x, y)]);
    }
    lines[y] = cellsToAnsi(row);
  }
  return lines;
}

function finalizeCell(buf: CellBuffer, cell: Cell): Cell {
  const bg = cell.style.bg;
  if (bg.a >= 1) return cell;
  if (bg.a <= 0) return cell;
  return {
    grapheme: cell.grapheme,
    width: cell.width,
    style: { ...cell.style, bg: blendOver(bg, buf.backdropColor) },
  };
}

function resolveBorder(style: BorderStyle | true): {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
  chars: typeof DEFAULT_BORDER_CHARS;
} {
  if (style === true) {
    return { top: true, right: true, bottom: true, left: true, chars: DEFAULT_BORDER_CHARS };
  }
  return {
    top: style.top !== false,
    right: style.right !== false,
    bottom: style.bottom !== false,
    left: style.left !== false,
    chars: style.chars ?? DEFAULT_BORDER_CHARS,
  };
}

function cellIsBlank(cell: Cell): boolean {
  if (cell.grapheme !== ' ' && cell.grapheme !== '') return false;
  const s = cell.style;
  if (s.bold || s.dim || s.italic || s.underline || s.strikethrough || s.reverse || s.blink || s.link !== undefined) {
    return false;
  }
  if (s.fg.intent !== 'default') return false;
  if (s.bg.intent !== 'default' && s.bg.a > 0) return false;
  return true;
}

function isBlankRow(buf: CellBuffer, y: number): boolean {
  const base = y * buf.width;
  for (let x = 0; x < buf.width; x++) {
    if (!cellIsBlank(buf.cells[base + x])) return false;
  }
  return true;
}

export function bufferUsedHeight(buf: CellBuffer): number {
  for (let y = buf.height - 1; y >= 0; y--) {
    if (!isBlankRow(buf, y)) return y + 1;
  }
  return 0;
}

export interface DiffRun {
  y: number;
  x: number;
  cells: Cell[];
  clear?: boolean;
}

export function diffBuffer(prev: CellBuffer, next: CellBuffer, maxRow: number, mergeGap = 4): DiffRun[] {
  const runs: DiffRun[] = [];
  const width = next.width;
  const rows = Math.min(maxRow, next.height);

  for (let y = 0; y < rows; y++) {
    const base = y * width;

    if (isBlankRow(next, y)) {
      if (!isBlankRow(prev, y)) runs.push({ y, x: 0, cells: [], clear: true });
      continue;
    }

    let x = 0;
    let prevEnd = 0;
    while (x < width) {
      if (cellEqual(prev.cells[base + x], next.cells[base + x])) {
        x++;
        continue;
      }

      let start = x;
      while (start > prevEnd && next.cells[base + start].width === 0) start--;

      let lastChange = x;
      let gap = 0;
      let xi = x + 1;
      while (xi < width) {
        if (!cellEqual(prev.cells[base + xi], next.cells[base + xi])) {
          lastChange = xi;
          gap = 0;
        } else {
          gap++;
          if (gap > mergeGap) break;
        }
        xi++;
      }

      let end = lastChange + 1;
      if (end < width && next.cells[base + end].width === 0) end++;

      const cells: Cell[] = [];
      for (let i = start; i < end; i++) cells.push(finalizeCell(next, next.cells[base + i]));
      runs.push({ y, x: start, cells });

      prevEnd = end;
      x = end;
    }
  }

  return runs;
}
