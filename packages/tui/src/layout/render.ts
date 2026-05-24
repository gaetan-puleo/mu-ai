import type { Capabilities } from '../capabilities';
import type { Component } from '../types/component';
import { parseLine } from './ansi';
import {
  type CellBuffer,
  drawBorderCells,
  fillBackground,
  popOpacity,
  pushOpacity,
  writeCells,
} from './cellbuffer';
import { colorToRgba } from './color';
import { isEmptyRect } from './insets';
import type { LayoutEntry, RenderContext } from './types';

/**
 * Composite a single layout entry onto the cell buffer.
 *
 * Steps:
 * 1. If the entry has subtree `opacity`, push it onto the buffer's stack.
 * 2. If the entry has a `backgroundColor` (with optional `backgroundOpacity`),
 *    blend it into the buffer rect — semi-transparent fills show what is
 *    already painted underneath.
 * 3. If the entry has a `border`, draw the box characters onto the buffer.
 * 4. Call `component.render(ctx)` to get ANSI-styled output lines.
 * 5. Parse each line into cells and composite onto the buffer at the entry's
 *    content rect, clipped by `entry.clipRect`.
 * 6. Pop opacity if it was pushed.
 */
export function drawEntry(
  buffer: CellBuffer,
  entry: LayoutEntry,
  focused: Component | null,
  capabilities: Capabilities,
  userContext?: unknown,
): void {
  if (isEmptyRect(entry.rect)) return;

  const opacity = entry.component.layout?.opacity;
  const hasOpacity = typeof opacity === 'number' && opacity < 1;
  if (hasOpacity) pushOpacity(buffer, opacity as number);

  try {
    const ownBg = entry.component.layout?.backgroundColor;
    if (ownBg) {
      const opacityFactor = entry.component.layout?.backgroundOpacity ?? 1;
      const rgba = colorToRgba(ownBg, opacityFactor);
      fillBackground(buffer, entry.rect, rgba, entry.clipRect);
    }

    const border = entry.component.layout?.border;
    if (border) {
      drawBorderCells(buffer, entry.rect, border, entry.clipRect);
    }

    if (isEmptyRect(entry.contentRect)) return;

    const ctx: RenderContext = {
      rect: entry.rect,
      contentRect: entry.contentRect,
      focused: entry.component === focused,
      capabilities,
      userContext,
    };

    const rawLines = entry.component.render(ctx);
    const lines = rawLines.slice(0, entry.contentRect.height);

    for (let i = 0; i < lines.length; i++) {
      const cells = parseLine(lines[i]);
      writeCells(buffer, entry.contentRect.x, entry.contentRect.y + i, cells, entry.clipRect);
    }
  } finally {
    if (hasOpacity) popOpacity(buffer);
  }
}
