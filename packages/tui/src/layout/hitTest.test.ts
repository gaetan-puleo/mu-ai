import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';

import type { Component } from '../types/component';
import { hitTest, hitTestRect } from './hitTest';
import type { LayoutEntry, Rect } from './types';

const c = (label: string): Component => ({ render: () => [label] });
const wholeScreen: Rect = { x: 0, y: 0, width: 100, height: 100 };

function entry(label: string, rect: Rect, zIndex = 0, order = 0, depth = 0, parent?: Component): LayoutEntry {
  return {
    component: c(label),
    rect,
    contentRect: rect,
    clipRect: wholeScreen,
    zIndex,
    depth,
    order,
    parent,
  };
}

describe('hitTest', () => {
  it('returns the entry containing the point', () => {
    const a = entry('a', { x: 0, y: 0, width: 10, height: 5 }, 0, 0);
    const b = entry('b', { x: 20, y: 0, width: 10, height: 5 }, 0, 1);
    expect(hitTest([a, b], 5, 2)?.component).toBe(a.component);
    expect(hitTest([a, b], 25, 2)?.component).toBe(b.component);
    expect(hitTest([a, b], 15, 2)).toBeNull();
  });

  it('higher zIndex wins on overlap', () => {
    const lower = entry('lower', { x: 0, y: 0, width: 10, height: 5 }, 0, 0);
    const higher = entry('higher', { x: 0, y: 0, width: 10, height: 5 }, 5, 1);
    expect(hitTest([lower, higher], 5, 2)?.component).toBe(higher.component);
  });

  it('later order wins on equal zIndex and depth', () => {
    const earlier = entry('earlier', { x: 0, y: 0, width: 10, height: 5 }, 0, 0);
    const later = entry('later', { x: 0, y: 0, width: 10, height: 5 }, 0, 1);
    expect(hitTest([earlier, later], 5, 2)?.component).toBe(later.component);
  });

  it('respects clip rect', () => {
    const clipped: LayoutEntry = {
      component: c('clipped'),
      rect: { x: 0, y: 0, width: 50, height: 50 },
      contentRect: { x: 0, y: 0, width: 50, height: 50 },
      clipRect: { x: 0, y: 0, width: 10, height: 10 },
      zIndex: 0,
      depth: 0,
      order: 0,
    };
    expect(hitTest([clipped], 5, 5)?.component).toBe(clipped.component);
    expect(hitTest([clipped], 20, 20)).toBeNull();
  });

  it('hitTestRect uses outer rect including border', () => {
    const e: LayoutEntry = {
      component: c('chrome'),
      rect: { x: 0, y: 0, width: 10, height: 5 },
      contentRect: { x: 1, y: 1, width: 8, height: 3 },
      clipRect: wholeScreen,
      zIndex: 0,
      depth: 0,
      order: 0,
    };
    expect(hitTestRect([e], 0, 0)?.component).toBe(e.component);
    expect(hitTest([e], 0, 0)).toBeNull();
  });

  it('descendant wins over its ancestor regardless of zIndex', () => {
    const parent = entry('parent', { x: 0, y: 0, width: 10, height: 5 }, 1000, 0, 0);
    const child = entry('child', { x: 0, y: 0, width: 10, height: 5 }, 0, 1, 1, parent.component);
    expect(hitTest([parent, child], 5, 2)?.component).toBe(child.component);
  });

  it('deeper entry wins on equal zIndex when unrelated', () => {
    const shallow = entry('shallow', { x: 0, y: 0, width: 10, height: 5 }, 0, 0, 0);
    const deep = entry('deep', { x: 0, y: 0, width: 10, height: 5 }, 0, 1, 2);
    expect(hitTest([shallow, deep], 5, 2)?.component).toBe(deep.component);
  });

  it('high-zIndex sibling still wins over unrelated low-zIndex entry', () => {
    const low = entry('low', { x: 0, y: 0, width: 10, height: 5 }, 0, 0, 1);
    const high = entry('high', { x: 0, y: 0, width: 10, height: 5 }, 100, 1, 1);
    expect(hitTest([low, high], 5, 2)?.component).toBe(high.component);
  });
});
