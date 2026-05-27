import type { BorderStyle, Insets, Rect } from './types';

const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Normalize a numeric shorthand or `Partial<Insets>` to a full `Insets`. */
export function normalizeInsets(input?: number | Partial<Insets>): Insets {
  if (input === undefined) return { ...ZERO_INSETS };
  if (typeof input === 'number') {
    return { top: input, right: input, bottom: input, left: input };
  }
  return {
    top: input.top ?? 0,
    right: input.right ?? 0,
    bottom: input.bottom ?? 0,
    left: input.left ?? 0,
  };
}

/** Resolve a `border` style into the per-side insets it consumes. */
export function borderInsets(border?: boolean | BorderStyle): Insets {
  if (!border) return { ...ZERO_INSETS };
  if (border === true) {
    return { top: 1, right: 1, bottom: 1, left: 1 };
  }
  return {
    top: border.top === false ? 0 : 1,
    right: border.right === false ? 0 : 1,
    bottom: border.bottom === false ? 0 : 1,
    left: border.left === false ? 0 : 1,
  };
}

/** Shrink a rect by the given insets, clamping to a non-negative size. */
export function shrinkRect(rect: Rect, insets: Insets): Rect {
  const x = rect.x + insets.left;
  const y = rect.y + insets.top;
  const width = Math.max(0, rect.width - insets.left - insets.right);
  const height = Math.max(0, rect.height - insets.top - insets.bottom);
  return { x, y, width, height };
}

/** Compute the intersection of two rects. Returns a zero-area rect if disjoint. */
export function intersectRect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

/** Whether `(x, y)` falls inside `rect` (half-open: x in [x, x+w), y in [y, y+h)). */
export function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

/** Whether the rect has zero area. */
export function isEmptyRect(rect: Rect): boolean {
  return rect.width <= 0 || rect.height <= 0;
}

/** Sum of insets along a single axis. */
export function insetsForAxis(insets: Insets, axis: 'width' | 'height'): number {
  return axis === 'width' ? insets.left + insets.right : insets.top + insets.bottom;
}
