import type { Component } from '../types/component';
import { containsPoint } from './insets';
import type { LayoutEntry } from './types';

/**
 * Find the top-most layout entry whose `contentRect` contains `(x, y)`.
 *
 * Resolution order:
 * - Descendant wins over its own ancestor (so a child is never masked by
 *   a high-zIndex parent at the same point).
 * - Otherwise higher zIndex wins.
 * - Then deeper depth wins (more-specific element).
 * - Then later insertion order wins (later painted).
 *
 * Returns `null` if no entry contains the point.
 */
export function hitTest(entries: LayoutEntry[], x: number, y: number): LayoutEntry | null {
  const lookup = buildLookup(entries);
  let best: LayoutEntry | null = null;

  for (const entry of entries) {
    if (!containsPoint(entry.clipRect, x, y)) continue;
    if (!containsPoint(entry.contentRect, x, y)) continue;
    if (best === null || compareHit(entry, best, lookup) > 0) {
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
  const lookup = buildLookup(entries);
  let best: LayoutEntry | null = null;

  for (const entry of entries) {
    if (!containsPoint(entry.clipRect, x, y)) continue;
    if (!containsPoint(entry.rect, x, y)) continue;
    if (best === null || compareHit(entry, best, lookup) > 0) {
      best = entry;
    }
  }

  return best;
}

function buildLookup(entries: LayoutEntry[]): Map<Component, LayoutEntry> {
  const lookup = new Map<Component, LayoutEntry>();
  for (const entry of entries) lookup.set(entry.component, entry);
  return lookup;
}

function compareHit(a: LayoutEntry, b: LayoutEntry, lookup: Map<Component, LayoutEntry>): number {
  // Descendant wins over its own ancestor regardless of zIndex. This prevents
  // a transparent high-zIndex container from masking clicks/hovers on its
  // visible children.
  if (isAncestorOf(a, b, lookup)) return -1; // b is descendant of a → b wins
  if (isAncestorOf(b, a, lookup)) return 1;
  if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
  if (a.depth !== b.depth) return a.depth - b.depth;
  return a.order - b.order;
}

function isAncestorOf(ancestor: LayoutEntry, descendant: LayoutEntry, lookup: Map<Component, LayoutEntry>): boolean {
  let cursor: Component | undefined = descendant.parent;
  while (cursor) {
    if (cursor === ancestor.component) return true;
    cursor = lookup.get(cursor)?.parent;
  }
  return false;
}
