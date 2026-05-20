import { containsPoint } from './insets';
import type { LayoutEntry } from './types';

/**
 * Find the top-most layout entry whose `contentRect` contains `(x, y)`.
 *
 * Resolution order:
 * - Higher zIndex wins.
 * - On tie, deeper entries (later painted) win.
 * - On tie, entries with higher insertion order win (later painted).
 *
 * Returns `null` if no entry contains the point.
 */
export function hitTest(entries: LayoutEntry[], x: number, y: number): LayoutEntry | null {
  let best: LayoutEntry | null = null;

  for (const entry of entries) {
    if (!containsPoint(entry.clipRect, x, y)) continue;
    if (!containsPoint(entry.contentRect, x, y)) continue;
    if (best === null || compareHit(entry, best) > 0) {
      best = entry;
    }
  }

  return best;
}

/**
 * Find the top-most entry whose outer `rect` (including border) contains `(x, y)`.
 * Useful for border-area hit testing (e.g. clickable window chrome).
 */
export function hitTestRect(entries: LayoutEntry[], x: number, y: number): LayoutEntry | null {
  let best: LayoutEntry | null = null;

  for (const entry of entries) {
    if (!containsPoint(entry.clipRect, x, y)) continue;
    if (!containsPoint(entry.rect, x, y)) continue;
    if (best === null || compareHit(entry, best) > 0) {
      best = entry;
    }
  }

  return best;
}

function compareHit(a: LayoutEntry, b: LayoutEntry): number {
  if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
  if (a.depth !== b.depth) return a.depth - b.depth;
  return a.order - b.order;
}
