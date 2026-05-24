import { sliceByColumn, visibleWidth } from '../utils';
import { containsPoint, intersectRect, isEmptyRect } from './insets';
import { type BorderStyle, type Color, DEFAULT_BORDER_CHARS, type Rect } from './types';

/**
 * @deprecated Use `CellBuffer` from `./cellbuffer` for new code. This
 * line-based canvas cannot support alpha compositing or per-cell styling.
 * Kept only for backward-compatible consumers of the old API.
 *
 * Line-based canvas. Each row is a single string of visible cells.
 *
 * Limitation: overlapping ANSI styled spans on the same row cannot be perfectly
 * composed without a cell-level model. Callers should use line-by-line resets
 * (the TUI render pipeline already appends a reset per line) and avoid relying
 * on overlapping styled content.
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
export function drawLines(
  canvas: Canvas,
  x: number,
  y: number,
  lines: string[],
  clip: Rect,
  backgroundColor?: Color,
): void {
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
    const clipped = withBackground(sliceByColumn(lines[i], sliceStart, sliceEnd, true), backgroundColor);

    overwriteRow(canvas, drawRect.x, targetY, clipped, drawRect.width);
  }
}

/** Fill `rect` with background-colored spaces, clipped to `clip`. */
export function drawBackground(canvas: Canvas, rect: Rect, color: Color, clip: Rect): void {
  if (canvas.width === 0 || canvas.height === 0) return;
  if (rect.width <= 0 || rect.height <= 0) return;

  const prefix = backgroundColorToAnsi(color);
  if (!prefix) return;

  const safeClip = intersectRect(clip, { x: 0, y: 0, width: canvas.width, height: canvas.height });
  const drawRect = intersectRect(rect, safeClip);
  if (isEmptyRect(drawRect)) return;

  const line = `${prefix}${' '.repeat(drawRect.width)}\x1b[0m`;
  for (let y = drawRect.y; y < drawRect.y + drawRect.height; y++) {
    overwriteRow(canvas, drawRect.x, y, line, drawRect.width);
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

function backgroundColorToAnsi(color: Color): string | undefined {
  if (color.startsWith('#')) return hexBackgroundToAnsi(color);
  return NAMED_BACKGROUND_COLORS[color as NamedColor];
}

function withBackground(text: string, color: Color | undefined): string {
  if (!color) return text;
  const prefix = backgroundColorToAnsi(color);
  if (!prefix) return text;
  // deno-lint-ignore no-control-regex
  const resetPattern = new RegExp('\\x1b\\[0m', 'g');
  return `${prefix}${text.replace(resetPattern, `\x1b[0m${prefix}`)}\x1b[0m`;
}

function hexBackgroundToAnsi(color: string): string | undefined {
  const hex = color.slice(1);
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const r = Number.parseInt(hex[0] + hex[0], 16);
    const g = Number.parseInt(hex[1] + hex[1], 16);
    const b = Number.parseInt(hex[2] + hex[2], 16);
    return `\x1b[48;2;${r};${g};${b}m`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return `\x1b[48;2;${r};${g};${b}m`;
  }
  return undefined;
}

type NamedColor = Exclude<Color, `#${string}`>;

const NAMED_BACKGROUND_COLORS: Record<NamedColor, string> = {
  black: '\x1b[40m',
  red: '\x1b[41m',
  green: '\x1b[42m',
  yellow: '\x1b[43m',
  blue: '\x1b[44m',
  magenta: '\x1b[45m',
  cyan: '\x1b[46m',
  white: '\x1b[47m',
  brightBlack: '\x1b[100m',
  brightRed: '\x1b[101m',
  brightGreen: '\x1b[102m',
  brightYellow: '\x1b[103m',
  brightBlue: '\x1b[104m',
  brightMagenta: '\x1b[105m',
  brightCyan: '\x1b[106m',
  brightWhite: '\x1b[107m',
};

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
