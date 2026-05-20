import type { Capabilities } from '../capabilities';
import type { Component } from '../types/component';
import { type Canvas, drawBorder, drawLines } from './canvas';
import { isEmptyRect } from './insets';
import type { LayoutEntry, RenderContext } from './types';

/**
 * Render a single layout entry onto the canvas.
 *
 * Steps:
 * 1. Build the `RenderContext` from the entry.
 * 2. Call `component.render(ctx)` to get content lines.
 * 3. Vertically clip the lines to the content rect height.
 * 4. Draw the border (if any) at the entry's outer rect.
 * 5. Draw the content lines at the entry's content rect, clipped by `clipRect`.
 */
export function drawEntry(
  canvas: Canvas,
  entry: LayoutEntry,
  focused: Component | null,
  capabilities: Capabilities,
): void {
  if (isEmptyRect(entry.rect)) return;

  const border = entry.component.layout?.border;
  if (border) {
    drawBorder(canvas, entry.rect, border, entry.clipRect);
  }

  if (isEmptyRect(entry.contentRect)) return;

  const ctx: RenderContext = {
    rect: entry.rect,
    contentRect: entry.contentRect,
    focused: entry.component === focused,
    capabilities,
  };

  const rawLines = entry.component.render(ctx);
  const lines = clipVertically(rawLines, entry.contentRect.height);

  drawLines(canvas, entry.contentRect.x, entry.contentRect.y, lines, entry.clipRect);
}

function clipVertically(lines: string[], maxHeight: number): string[] {
  if (lines.length <= maxHeight) return lines;
  return lines.slice(0, maxHeight);
}
