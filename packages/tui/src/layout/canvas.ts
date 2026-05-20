import { sliceByColumn, visibleWidth } from '../utils';
import { containsPoint, intersectRect, isEmptyRect } from './insets';
import { type BorderStyle, DEFAULT_BORDER_CHARS, type Rect } from './types';

/**
 * Line-based canvas. Each row is a single string of visible cells.
 *
 * Limitation: overlapping ANSI styled spans on the same row cannot be perfectly
 * composed without a cell-level model. Callers should use line-by-line resets
 * (the TUI render pipeline already appends a reset per line) and avoid relying
 * on overlapping styled content at v1.
 */
export interface Canvas {
  width: number;
  height: number;
  lines: string[];
}

/** Create a blank canvas filled with spaces. */
export function createCanvas(width: number, height: number): Canvas {
  const lines: string[] = new Array(Math.max(0, height));
  const blank = ' '.repeat(Math.max(0, width));
  for (let i = 0; i < lines.length; i++) lines[i] = blank;
  return { width: Math.max(0, width), height: Math.max(0, height), lines };
}

/**
 * Draw `lines` onto the canvas starting at `(x, y)`, clipping to `clip`.
 *
 * - Vertically: drop lines whose row is outside `clip`.
 * - Horizontally: clip each line to the intersection of its target span with `clip`.
 * - Pad with spaces if the line is shorter than its allotted width.
 */
export function drawLines(canvas: Canvas, x: number, y: number, lines: string[], clip: Rect): void {
  if (canvas.width === 0 || canvas.height === 0) return;
  const canvasRect: Rect = { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const safeClip = intersectRect(clip, canvasRect);
  if (isEmptyRect(safeClip)) return;

  for (let i = 0; i < lines.length; i++) {
    const targetY = y + i;
    if (targetY < safeClip.y || targetY >= safeClip.y + safeClip.height) continue;

    const lineVisibleWidth = visibleWidth(lines[i]);
    if (lineVisibleWidth === 0) continue;

    const lineRect: Rect = { x, y: targetY, width: lineVisibleWidth, height: 1 };
    const drawRect = intersectRect(lineRect, safeClip);
    if (isEmptyRect(drawRect)) continue;

    const sliceStart = drawRect.x - x;
    const sliceEnd = sliceStart + drawRect.width;
    const clipped = sliceByColumn(lines[i], sliceStart, sliceEnd, true);

    overwriteRow(canvas, drawRect.x, targetY, clipped, drawRect.width);
  }
}

/**
 * Draw a border around `rect` using `style.chars` (defaulting to Unicode box chars).
 * Sides are individually drawable. If `rect` is too small for borders to fit
 * cleanly, sides degrade gracefully (corners reuse horizontal/vertical fallbacks).
 */
export function drawBorder(canvas: Canvas, rect: Rect, style: BorderStyle | true, clip: Rect): void {
  if (canvas.width === 0 || canvas.height === 0) return;
  if (rect.width <= 0 || rect.height <= 0) return;

  const resolved = resolveBorderStyle(style);
  const safeClip = intersectRect(clip, { x: 0, y: 0, width: canvas.width, height: canvas.height });
  if (isEmptyRect(safeClip)) return;

  drawHorizontalBorder(canvas, rect, resolved, safeClip, 'top');
  drawHorizontalBorder(canvas, rect, resolved, safeClip, 'bottom');
  drawVerticalBorder(canvas, rect, resolved, safeClip, 'left');
  drawVerticalBorder(canvas, rect, resolved, safeClip, 'right');
}

function resolveBorderStyle(style: BorderStyle | true): Required<BorderStyle> {
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

function drawHorizontalBorder(
  canvas: Canvas,
  rect: Rect,
  style: Required<BorderStyle>,
  clip: Rect,
  side: 'top' | 'bottom',
): void {
  if (side === 'top' && (!style.top || rect.height < 1)) return;
  if (side === 'bottom' && (!style.bottom || rect.height < 2)) return;

  const c = style.chars;
  const leftCorner = side === 'top' ? c.topLeft : c.bottomLeft;
  const rightCorner = side === 'top' ? c.topRight : c.bottomRight;
  const line = buildHorizontalLine(
    rect.width,
    style.left ? leftCorner : c.horizontal,
    style.right ? rightCorner : c.horizontal,
    c.horizontal,
  );
  const y = side === 'top' ? rect.y : rect.y + rect.height - 1;
  drawLines(canvas, rect.x, y, [line], clip);
}

function drawVerticalBorder(
  canvas: Canvas,
  rect: Rect,
  style: Required<BorderStyle>,
  clip: Rect,
  side: 'left' | 'right',
): void {
  if (side === 'left' && (!style.left || rect.width < 1)) return;
  if (side === 'right' && (!style.right || rect.width < 2)) return;

  const startY = rect.y + (style.top ? 1 : 0);
  const endY = rect.y + rect.height - (style.bottom ? 1 : 0);
  if (endY <= startY) return;

  const verticalLines: string[] = [];
  for (let y = startY; y < endY; y++) verticalLines.push(style.chars.vertical);
  const x = side === 'left' ? rect.x : rect.x + rect.width - 1;
  drawLines(canvas, x, startY, verticalLines, clip);
}

/** Snapshot the canvas as plain lines. */
export function canvasToLines(canvas: Canvas): string[] {
  return canvas.lines.slice();
}

/** Test whether a point lies inside a rect. Re-exported here for convenience. */
export const pointInRect = containsPoint;

function buildHorizontalLine(width: number, left: string, right: string, mid: string): string {
  if (width <= 0) return '';
  if (width === 1) return left;
  if (width === 2) return left + right;
  return left + mid.repeat(width - 2) + right;
}

function overwriteRow(canvas: Canvas, x: number, y: number, text: string, textWidth: number): void {
  if (y < 0 || y >= canvas.lines.length) return;
  const line = canvas.lines[y];
  const left = sliceByColumn(line, 0, x, true);
  const leftWidth = visibleWidth(left);
  const leftPad = x - leftWidth > 0 ? ' '.repeat(x - leftWidth) : '';
  const right = sliceByColumn(line, x + textWidth, canvas.width, true);

  let next = left + leftPad + text + right;
  const nextWidth = visibleWidth(next);
  if (nextWidth < canvas.width) {
    next += ' '.repeat(canvas.width - nextWidth);
  } else if (nextWidth > canvas.width) {
    next = sliceByColumn(next, 0, canvas.width, true);
  }
  canvas.lines[y] = next;
}
