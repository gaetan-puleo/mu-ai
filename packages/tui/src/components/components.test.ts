import { describe, expect, it } from 'vitest';

import { createDefaultCapabilities } from '../capabilities';
import { layoutTree } from '../layout/engine';
import type { RenderContext } from '../layout/types';
import type { Component } from '../types/component';
import { visibleWidth } from '../utils';
import { Box } from './Box';
import { Button } from './Button';
import { Input } from './Input';
import { ScrollView } from './ScrollView';
import { SelectList } from './SelectList';
import { Spacer } from './Spacer';
import { Text } from './Text';

const caps = createDefaultCapabilities({ TERM: 'xterm-256color' });

function ctx(width: number, height: number, focused = false): RenderContext {
  const rect = { x: 0, y: 0, width, height };
  return { rect, contentRect: rect, focused, capabilities: caps };
}

describe('Text', () => {
  it('renders within the content rect width', () => {
    const text = new Text({ text: 'Hello World, this is a long line that should wrap' });
    const lines = text.render(ctx(10, 5));
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(10);
  });

  it('truncates when wrap is disabled', () => {
    const text = new Text({ text: 'Hello World', wrap: false });
    const lines = text.render(ctx(8, 1));
    expect(lines).toHaveLength(1);
    expect(visibleWidth(lines[0])).toBeLessThanOrEqual(8);
  });

  it('reports natural size via measure', () => {
    const text = new Text({ text: 'Hello' });
    const size = text.measure({ minWidth: 0, maxWidth: 80, minHeight: 0, maxHeight: 80 });
    expect(size.width).toBe(5);
    expect(size.height).toBe(1);
  });
});

describe('Box', () => {
  it('lays out children with row direction', () => {
    const left = new Text({ text: 'L', layout: { width: 4 } });
    const right = new Text({ text: 'R', layout: { width: 'fill' } });
    const box = new Box({ layout: { direction: 'row' }, children: [left, right] });
    const entries = layoutTree([box], { x: 0, y: 0, width: 20, height: 5 }, null, caps);
    const leftEntry = entries.find((e) => e.component === left);
    const rightEntry = entries.find((e) => e.component === right);
    expect(leftEntry?.rect).toMatchObject({ x: 0, width: 4 });
    expect(rightEntry?.rect).toMatchObject({ x: 4, width: 16 });
  });

  it('does not contribute content lines', () => {
    const box = new Box();
    expect(box.render()).toEqual([]);
  });
});

describe('Spacer', () => {
  it('reserves space when sized with fill', () => {
    const a = new Text({ text: 'a', layout: { width: 4 } });
    const b = new Spacer();
    const c = new Text({ text: 'c', layout: { width: 4 } });
    const box = new Box({ layout: { direction: 'row' }, children: [a, b, c] });
    const entries = layoutTree([box], { x: 0, y: 0, width: 20, height: 1 }, null, caps);
    const spacerEntry = entries.find((e) => e.component === b);
    expect(spacerEntry?.rect.width).toBe(12);
  });
});

describe('Button', () => {
  it('renders with focus styling when focused', () => {
    const button = new Button({ label: 'Run' });
    const unfocused = button.render(ctx(10, 1, false));
    const focused = button.render(ctx(10, 1, true));
    expect(unfocused[0]).toContain('Run');
    expect(focused[0]).toContain('Run');
    expect(focused[0]).not.toBe(unfocused[0]);
  });

  it('invokes onPress on Enter when focused', () => {
    let pressed = 0;
    const button = new Button({ label: 'Run', onPress: () => pressed++ });
    button.handleEvent(
      {
        type: 'key',
        key: 'enter',
        kind: 'press',
        source: 'legacy',
        raw: '',
        shift: false,
        ctrl: false,
        alt: false,
        meta: false,
      },
      { rect: { x: 0, y: 0, width: 1, height: 1 }, contentRect: { x: 0, y: 0, width: 1, height: 1 }, focused: true },
    );
    expect(pressed).toBe(1);
  });

  it('invokes onPress on left mouse click', () => {
    let pressed = 0;
    const button = new Button({ label: 'Run', onPress: () => pressed++ });
    button.handleEvent(
      {
        type: 'mouse',
        kind: 'press',
        button: 'left',
        x: 0,
        y: 0,
        coordinateSpace: 'cells',
        source: 'sgr',
        raw: '',
        shift: false,
        ctrl: false,
        alt: false,
        meta: false,
      },
      { rect: { x: 0, y: 0, width: 1, height: 1 }, contentRect: { x: 0, y: 0, width: 1, height: 1 }, focused: true },
    );
    expect(pressed).toBe(1);
  });
});

describe('Input', () => {
  it('inserts text and tracks cursor', () => {
    const input = new Input({ value: '' });
    input.focused = true;
    input.handleEvent(
      { type: 'text', text: 'abc', raw: 'abc' },
      { rect: { x: 0, y: 0, width: 1, height: 1 }, contentRect: { x: 0, y: 0, width: 1, height: 1 }, focused: true },
    );
    expect(input.value).toBe('abc');
    expect(input.cursor).toBe(3);
  });

  it('handles backspace', () => {
    const input = new Input({ value: 'abc' });
    input.handleEvent(
      {
        type: 'key',
        key: 'backspace',
        kind: 'press',
        source: 'legacy',
        raw: '',
        shift: false,
        ctrl: false,
        alt: false,
        meta: false,
      },
      { rect: { x: 0, y: 0, width: 1, height: 1 }, contentRect: { x: 0, y: 0, width: 1, height: 1 }, focused: true },
    );
    expect(input.value).toBe('ab');
  });

  it('shows placeholder when empty and unfocused', () => {
    const input = new Input({ placeholder: 'enter…' });
    const lines = input.render(ctx(10, 1, false));
    expect(lines[0]).toContain('enter…');
  });
});

describe('SelectList', () => {
  const items = [{ label: 'one' }, { label: 'two' }, { label: 'three' }];

  it('renders items and marks selection when focused', () => {
    const list = new SelectList({ items });
    const focused = list.render(ctx(10, 3, true));
    const unfocused = list.render(ctx(10, 3, false));
    expect(focused[0]).not.toEqual(unfocused[0]);
  });

  it('arrow keys move selection', () => {
    let changed: number | null = null;
    const list = new SelectList({ items, onChange: (_item, idx) => (changed = idx) });
    list.handleEvent(
      {
        type: 'key',
        key: 'down',
        kind: 'press',
        source: 'legacy',
        raw: '',
        shift: false,
        ctrl: false,
        alt: false,
        meta: false,
      },
      { rect: { x: 0, y: 0, width: 1, height: 1 }, contentRect: { x: 0, y: 0, width: 1, height: 1 }, focused: true },
    );
    expect(list.selectedIndex).toBe(1);
    expect(changed).toBe(1);
  });

  it('Enter triggers onSelect', () => {
    let selected: string | null = null;
    const list = new SelectList({ items, onSelect: (item) => (selected = item.label) });
    list.handleEvent(
      {
        type: 'key',
        key: 'enter',
        kind: 'press',
        source: 'legacy',
        raw: '',
        shift: false,
        ctrl: false,
        alt: false,
        meta: false,
      },
      { rect: { x: 0, y: 0, width: 1, height: 1 }, contentRect: { x: 0, y: 0, width: 1, height: 1 }, focused: true },
    );
    expect(selected).toBe('one');
  });
});

describe('ScrollView', () => {
  it('exposes a single inner container as its only child', () => {
    const child: Component = { render: () => ['child'] };
    const view = new ScrollView({ children: [child] });
    expect(view.children).toHaveLength(1);
    expect(view.children[0].children).toEqual([child]);
  });

  it('shifts inner container y when scrolling', () => {
    const view = new ScrollView({ children: [{ render: () => [''], layout: { height: 50 } }] });
    view.scrollTo(5);
    expect(view.children[0].layout?.y).toBe(-5);
  });

  it('clamps scroll to non-negative', () => {
    const view = new ScrollView({ children: [{ render: () => [''], layout: { height: 1 } }] });
    view.scrollTo(-10);
    expect(view.scrollY).toBe(0);
  });
});
