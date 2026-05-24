import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';

import { createDefaultCapabilities } from '../capabilities';
import type { Component } from '../types/component';
import { layoutTree, sortForRender } from './engine';
import type { LayoutEntry, Rect } from './types';

const caps = createDefaultCapabilities({ TERM: 'xterm-256color' });
const root: Rect = { x: 0, y: 0, width: 30, height: 10 };

function leaf(label: string, layout?: Component['layout']): Component {
  return { layout, render: () => [label] };
}

function findByRender(entries: LayoutEntry[], label: string): LayoutEntry | undefined {
  return entries.find((entry) => (entry.component.render({} as never) ?? [])[0] === label);
}

describe('layoutTree: row distribution', () => {
  it('lays out a row of fixed children', () => {
    const a = leaf('a', { width: 10 });
    const b = leaf('b', { width: 5 });
    const parent: Component = { layout: { direction: 'row' }, children: [a, b], render: () => [] };
    const entries = layoutTree([parent], root, null, caps);
    expect(findByRender(entries, 'a')?.rect).toMatchObject({ x: 0, y: 0, width: 10 });
    expect(findByRender(entries, 'b')?.rect).toMatchObject({ x: 10, y: 0, width: 5 });
  });

  it('mixes fixed and fractional children', () => {
    const a = leaf('a', { width: 10 });
    const b = leaf('b', { width: '1fr' });
    const parent: Component = { layout: { direction: 'row' }, children: [a, b], render: () => [] };
    const entries = layoutTree([parent], root, null, caps);
    expect(findByRender(entries, 'a')?.rect).toMatchObject({ x: 0, width: 10 });
    expect(findByRender(entries, 'b')?.rect).toMatchObject({ x: 10, width: 20 });
  });

  it('honors percent widths', () => {
    const a = leaf('a', { width: '50%' });
    const b = leaf('b', { width: 'fill' });
    const parent: Component = { layout: { direction: 'row' }, children: [a, b], render: () => [] };
    const entries = layoutTree([parent], root, null, caps);
    expect(findByRender(entries, 'a')?.rect.width).toBe(15);
    expect(findByRender(entries, 'b')?.rect.width).toBe(15);
  });

  it('clamps to min/max constraints', () => {
    const a = leaf('a', { width: '1fr', minWidth: 20 });
    const b = leaf('b', { width: '1fr' });
    const parent: Component = { layout: { direction: 'row' }, children: [a, b], render: () => [] };
    const entries = layoutTree([parent], root, null, caps);
    expect(findByRender(entries, 'a')?.rect.width).toBeGreaterThanOrEqual(20);
  });

  it('uses measure for auto sizing', () => {
    const measured: Component = {
      layout: { width: 'auto' },
      render: () => ['xxx'],
      measure: () => ({ width: 3, height: 1 }),
    };
    const fill = leaf('b', { width: 'fill' });
    const parent: Component = { layout: { direction: 'row' }, children: [measured, fill], render: () => [] };
    const entries = layoutTree([parent], root, null, caps);
    expect(entries.find((entry) => entry.component === measured)?.rect.width).toBe(3);
    expect(entries.find((entry) => entry.component === fill)?.rect.width).toBe(27);
  });
});

describe('layoutTree: box model', () => {
  it('subtracts padding from content rect', () => {
    const child = leaf('a');
    const parent: Component = { layout: { padding: 2 }, children: [child], render: () => [] };
    const entries = layoutTree([parent], root, null, caps);
    expect(entries.find((entry) => entry.component === parent)?.contentRect).toEqual({
      x: 2,
      y: 2,
      width: 26,
      height: 6,
    });
  });

  it('subtracts border from content rect', () => {
    const child = leaf('a');
    const parent: Component = { layout: { border: true }, children: [child], render: () => [] };
    const entries = layoutTree([parent], root, null, caps);
    expect(entries.find((entry) => entry.component === parent)?.contentRect).toEqual({
      x: 1,
      y: 1,
      width: 28,
      height: 8,
    });
  });

  it('treats margin as outer space', () => {
    const child = leaf('a', { width: 10, margin: { left: 4 } });
    const parent: Component = { layout: { direction: 'row' }, children: [child], render: () => [] };
    const entries = layoutTree([parent], root, null, caps);
    expect(findByRender(entries, 'a')?.rect).toMatchObject({ x: 4, width: 10 });
  });
});

describe('layoutTree: positioning and overflow', () => {
  it('places absolutely positioned children at their declared offset', () => {
    const abs = leaf('abs', { position: 'absolute', x: 5, y: 3, width: 8, height: 2 });
    const root1 = leaf('host');
    const parent: Component = { layout: { direction: 'column' }, children: [root1, abs], render: () => [] };
    const entries = layoutTree([parent], root, null, caps);
    expect(findByRender(entries, 'abs')?.rect).toMatchObject({ x: 5, y: 3, width: 8, height: 2 });
  });

  it('defaults overlay zIndex above relative children', () => {
    const overlay = leaf('o', { position: 'overlay', width: 4, height: 2 });
    const parent: Component = { children: [overlay], render: () => [] };
    const entries = layoutTree([parent], root, null, caps);
    expect(findByRender(entries, 'o')?.zIndex).toBe(100);
  });

  it('sorts entries by zIndex / order', () => {
    const a = leaf('a', { zIndex: 5 });
    const b = leaf('b', { zIndex: 1 });
    const sorted = sortForRender([
      { component: a, rect: root, contentRect: root, clipRect: root, zIndex: 5, depth: 0, order: 0 },
      { component: b, rect: root, contentRect: root, clipRect: root, zIndex: 1, depth: 0, order: 1 },
    ]);
    expect(sorted[0].zIndex).toBe(1);
    expect(sorted[1].zIndex).toBe(5);
  });

  it('keeps overlay descendants above their parent chrome', () => {
    const modal = leaf('modal', { zIndex: 1000 });
    const content = leaf('content');
    const sibling = leaf('sibling', { zIndex: 10 });
    const entries: LayoutEntry[] = [
      { component: sibling, rect: root, contentRect: root, clipRect: root, zIndex: 10, depth: 1, order: 0 },
      {
        component: content,
        rect: root,
        contentRect: root,
        clipRect: root,
        zIndex: 0,
        depth: 2,
        order: 2,
        parent: modal,
      },
      { component: modal, rect: root, contentRect: root, clipRect: root, zIndex: 1000, depth: 1, order: 1 },
    ];

    expect(sortForRender(entries).map((entry) => entry.component)).toEqual([sibling, modal, content]);
  });

  it('clips child clip rects under overflow:hidden parent', () => {
    const child = leaf('inside', { width: 100, height: 100 });
    const parent: Component = {
      layout: { width: 10, height: 5, overflow: 'hidden' },
      children: [child],
      render: () => [],
    };
    const entries = layoutTree([parent], root, null, caps);
    const childEntry = findByRender(entries, 'inside');
    expect(childEntry?.clipRect.width).toBeLessThanOrEqual(10);
    expect(childEntry?.clipRect.height).toBeLessThanOrEqual(5);
  });
});
