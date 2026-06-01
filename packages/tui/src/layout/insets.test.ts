import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';

import { borderInsets, containsPoint, intersectRect, isEmptyRect, normalizeInsets, shrinkRect } from './insets';

describe('insets', () => {
  it('normalizes the numeric shorthand notation', () => {
    expect(normalizeInsets(2)).toEqual({ top: 2, right: 2, bottom: 2, left: 2 });
    expect(normalizeInsets()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(normalizeInsets({ left: 3 })).toEqual({ top: 0, right: 0, bottom: 0, left: 3 });
  });

  it('derives border insets from the style', () => {
    expect(borderInsets(true)).toEqual({ top: 1, right: 1, bottom: 1, left: 1 });
    expect(borderInsets(false)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(borderInsets({ top: true, right: false, bottom: true, left: true })).toEqual({
      top: 1,
      right: 0,
      bottom: 1,
      left: 1,
    });
  });

  it('shrinks rects', () => {
    const rect = { x: 5, y: 5, width: 10, height: 10 };
    const inset = { top: 1, right: 2, bottom: 3, left: 4 };
    const shrunk = shrinkRect(rect, inset);
    expect(shrunk).toEqual({ x: 9, y: 6, width: 4, height: 6 });
  });

  it('clamps shrinking to a non-negative size', () => {
    const tiny = shrinkRect({ x: 0, y: 0, width: 2, height: 2 }, { top: 5, right: 5, bottom: 5, left: 5 });
    expect(tiny).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });

  it('intersects rects', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 5, y: 5, width: 10, height: 10 };
    expect(intersectRect(a, b)).toEqual({ x: 5, y: 5, width: 5, height: 5 });

    const disjoint = { x: 100, y: 0, width: 5, height: 5 };
    expect(isEmptyRect(intersectRect(a, disjoint))).toBe(true);
  });

  it('contains points (half-open)', () => {
    const rect = { x: 0, y: 0, width: 3, height: 3 };
    expect(containsPoint(rect, 0, 0)).toBe(true);
    expect(containsPoint(rect, 2, 2)).toBe(true);
    expect(containsPoint(rect, 3, 0)).toBe(false);
    expect(containsPoint(rect, 0, 3)).toBe(false);
    expect(containsPoint(rect, -1, 0)).toBe(false);
  });
});
