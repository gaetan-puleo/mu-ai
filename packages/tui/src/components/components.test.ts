import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';

import { createDefaultCapabilities } from '../capabilities';
import { cellBufferToLines as canvasToLines, createCellBuffer as createCanvas } from '../layout/cellbuffer';
import { layoutTree, sortForRender } from '../layout/engine';
import { drawEntry } from '../layout/render';
import type { LayoutEntry, RenderContext } from '../layout/types';
import { TUI } from '../tui';
import type { Component } from '../types/component';
import type { Terminal } from '../types/terminal';
import { stripAnsi, visibleWidth } from '../utils';
import { Box } from './Box';
import { Input } from './Input';
import { Modal } from './Modal';
import { ScrollView } from './ScrollView';
import { SelectList } from './SelectList';
import { Text } from './Text';

const caps = createDefaultCapabilities({ TERM: 'xterm-256color' });

class TestTerminal implements Terminal {
  readonly columns = 20;
  readonly rows = 6;

  write(): void {
    // Test terminal no-op.
  }
  hideCursor(): void {
    // Test terminal no-op.
  }
  showCursor(): void {
    // Test terminal no-op.
  }
  clearScreen(): void {
    // Test terminal no-op.
  }
  clearLine(): void {
    // Test terminal no-op.
  }
  clearFromCursor(): void {
    // Test terminal no-op.
  }
  moveBy(): void {
    // Test terminal no-op.
  }
}

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

  it('measures children for auto sizing', () => {
    const child = new Text({ text: 'hello' });
    const box = new Box({ children: [child] });

    expect(box.measure({ minWidth: 0, maxWidth: 20, minHeight: 0, maxHeight: 20 })).toEqual({ width: 5, height: 1 });
  });

  it('draws background before border and children', () => {
    const child = new Text({ text: 'Hi', layout: { width: 2, height: 1 } });
    const box = new Box({
      layout: { width: 6, height: 3, border: true, backgroundColor: '#123456' },
      children: [child],
    });
    const entries = layoutTree([box], { x: 0, y: 0, width: 6, height: 3 }, null, caps);
    const canvas = createCanvas(6, 3);

    for (const entry of entries) drawEntry(canvas, entry, null, caps);

    const lines = canvasToLines(canvas);
    expect(lines[0]).toContain('\x1b[48;2;18;52;86m');
    expect(stripAnsi(lines[0])).toBe('┌────┐');
    expect(stripAnsi(lines[1])).toContain('Hi');
  });

  it('uses parent background for child content by default', () => {
    const child = new Text({ text: 'Hi', layout: { width: 2, height: 1 } });
    const box = new Box({ layout: { width: 6, height: 1, backgroundColor: '#123456' }, children: [child] });
    const entries = layoutTree([box], { x: 0, y: 0, width: 6, height: 1 }, null, caps);
    const canvas = createCanvas(6, 1);

    for (const entry of sortForRender(entries)) drawEntry(canvas, entry, null, caps);

    const line = canvasToLines(canvas)[0];
    // Parent's bg fills the whole row; child content (Hi) inherits it.
    expect(line).toContain('48;2;18;52;86');
    expect(line).toContain('Hi');
    expect(stripAnsi(line)).toBe('Hi    ');
  });

  it('lets child background override inherited parent background', () => {
    const child = new Text({ text: 'Hi', layout: { width: 2, height: 1, backgroundColor: 'red' } });
    const box = new Box({ layout: { width: 6, height: 1, backgroundColor: 'blue' }, children: [child] });
    const entries = layoutTree([box], { x: 0, y: 0, width: 6, height: 1 }, null, caps);
    const canvas = createCanvas(6, 1);

    for (const entry of sortForRender(entries)) drawEntry(canvas, entry, null, caps);

    const line = canvasToLines(canvas)[0];
    // Child red bg covers its 2 cells; parent blue bg fills the rest of the row.
    expect(line).toContain('\x1b[41m');
    expect(line).toContain('Hi');
    expect(line).toContain('44m'); // parent's blue bg present somewhere in the row
    expect(stripAnsi(line)).toBe('Hi    ');
  });
});

describe('Modal', () => {
  it('renders a centered panel over a dim backdrop', () => {
    const modal = new Modal({ title: 'Help', body: 'Use /help', width: 20, height: 5 });
    const lines = modal.render(ctx(40, 9)).map(stripAnsi);

    expect(lines).toHaveLength(9);
    expect(lines.some((line) => line.includes('Help'))).toBe(true);
    expect(lines.some((line) => line.includes('Use /help'))).toBe(true);
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

  it('hides a configured prefix while keeping it editable', () => {
    const input = new Input({ value: '!ls', hiddenPrefix: '!' });
    input.focused = true;

    expect(stripAnsi(input.render(ctx(10, 1, true))[0] ?? '')).toBe('ls        ');
    expect(input.value).toBe('!ls');

    input.setValue('!');
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

    expect(input.value).toBe('');
  });

  it('inserts a newline on Shift+Enter', () => {
    const input = new Input({ value: 'hello' });
    input.handleEvent(
      {
        type: 'key',
        key: 'enter',
        kind: 'press',
        source: 'legacy',
        raw: '',
        shift: true,
        ctrl: false,
        alt: false,
        meta: false,
      },
      { rect: { x: 0, y: 0, width: 1, height: 1 }, contentRect: { x: 0, y: 0, width: 1, height: 1 }, focused: true },
    );
    expect(input.value).toBe('hello\n');
  });

  it('submits on Enter without Shift', () => {
    let submitted = '';
    const input = new Input({ value: 'hello', onSubmit: (value) => (submitted = value) });
    input.handleEvent(
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
    expect(submitted).toBe('hello');
  });

  it('moves the cursor up and down between lines', () => {
    const input = new Input({ value: 'one\ntwo\nthree' });
    input.handleEvent(
      {
        type: 'key',
        key: 'up',
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
    expect(input.cursor).toBe(7);

    input.handleEvent(
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
    expect(input.cursor).toBe(11);
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

  it('applies resolved item style to unselected rows', () => {
    const list = new SelectList({
      items,
      resolveStyles: () => ({ item: '\x1b[31m', selected: '\x1b[32m' }),
    });
    const rendered = list.render(ctx(10, 3, true));
    expect(rendered[1]).toBe('\x1b[31mtwo       \x1b[0m');
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

  it('keeps fixed footer content outside the scroll viewport', () => {
    const scrollView = new ScrollView({ layout: { width: 'fill', height: 'fill' }, focusable: false });
    const transcriptBox = new Box({ layout: { width: 'fill', height: 'fill' }, children: [scrollView] });
    const status = new Text({ text: 'ready', layout: { width: 'fill', height: 1 } });
    const input = new Input({ layout: { width: 'fill', height: 1 } });
    const inputBox = new Box({ layout: { width: 'fill', height: 2 }, children: [input] });
    const root = new Box({
      layout: { width: 'fill', height: 'fill', direction: 'column' },
      children: [transcriptBox, status, inputBox],
    });

    const entries = layoutTree([root], { x: 0, y: 0, width: 20, height: 10 }, input, caps);
    const scrollEntry = entries.find((entry) => entry.component === scrollView);
    const inputEntry = entries.find((entry) => entry.component === input);

    expect(scrollView.layout.focusable).toBe(false);
    expect(scrollEntry?.rect).toMatchObject({ y: 0, height: 7 });
    expect(scrollEntry?.clipRect).toMatchObject({ y: 0, height: 7 });
    expect(inputEntry?.rect.y).toBeGreaterThanOrEqual(8);
  });

  it('receives wheel events bubbled from children while another component is focused', () => {
    const scrollView = new ScrollView({
      layout: { width: 'fill', height: 'fill' },
      focusable: false,
      children: [new Text({ text: 'line\n'.repeat(20), layout: { width: 'fill', height: 20 } })],
    });
    const input = new Input({ layout: { width: 'fill', height: 1 } });
    const root = new Box({
      layout: { width: 'fill', height: 'fill', direction: 'column' },
      children: [scrollView, input],
    });
    const tui = new TUI(new TestTerminal(), { synchronizedOutput: false });
    tui.addChild(root);
    tui.setFocus(input);

    (tui as unknown as { layoutEntries: LayoutEntry[] }).layoutEntries = tui.layoutSnapshot(20, 6);
    tui.handleMouseEvent({
      type: 'mouse',
      kind: 'wheel',
      button: 'wheelDown',
      x: 1,
      y: 1,
      coordinateSpace: 'cells',
      source: 'sgr',
      raw: '',
      shift: false,
      ctrl: false,
      alt: false,
      meta: false,
    });
    (tui as unknown as { stopped: boolean }).stopped = true;

    expect(tui.getFocused()).toBe(input);
    expect(scrollView.scrollY).toBe(1);
  });

  it('scrolls wrapped content that overflows the viewport height', () => {
    const scrollView = new ScrollView({
      children: [new Text({ text: 'word '.repeat(20), layout: { width: 'fill', height: 'auto' } })],
    });

    scrollView.handleEvent(
      {
        type: 'mouse',
        kind: 'wheel',
        button: 'wheelDown',
        x: 1,
        y: 1,
        coordinateSpace: 'cells',
        source: 'sgr',
        raw: '',
        shift: false,
        ctrl: false,
        alt: false,
        meta: false,
      },
      { rect: { x: 0, y: 0, width: 10, height: 2 }, contentRect: { x: 0, y: 0, width: 10, height: 2 }, focused: false },
    );

    expect(scrollView.scrollY).toBe(1);
  });

  it('reports whether the viewport is at the bottom', () => {
    const scrollView = new ScrollView({
      layout: { width: 'fill', height: 'fill' },
      children: [new Text({ text: 'line\n'.repeat(20), layout: { width: 'fill', height: 20 } })],
    });

    scrollView.render(ctx(10, 4));
    expect(scrollView.isAtBottom()).toBe(false);

    scrollView.scrollToBottom();
    expect(scrollView.isAtBottom()).toBe(true);

    scrollView.scrollBy(-2);
    expect(scrollView.isAtBottom()).toBe(false);
  });

  it('scrolls to the clamped bottom', () => {
    const scrollView = new ScrollView({
      layout: { width: 'fill', height: 'fill' },
      children: [new Text({ text: 'line\n'.repeat(20), layout: { width: 'fill', height: 20 } })],
    });

    scrollView.render(ctx(10, 4));
    scrollView.scrollToBottom();

    expect(scrollView.scrollY).toBe(16);
  });

  it('applies pending stick-to-bottom before laying out inner content', () => {
    const scrollView = new ScrollView({ layout: { width: 'fill', height: 'fill' } });
    scrollView.setChildren([{ render: () => [''], layout: { width: 'fill', height: 10 } }], { stickToBottom: true });

    const root = new Box({ layout: { width: 'fill', height: 'fill' }, children: [scrollView] });
    const entries = layoutTree([root], { x: 0, y: 0, width: 10, height: 4 }, scrollView, caps);
    const innerEntry = entries.find((entry) => entry.component === scrollView.children[0]);

    expect(scrollView.scrollY).toBe(6);
    expect(innerEntry?.rect.y).toBe(-6);
  });

  it('includes child vertical margins when clamping bottom scroll', () => {
    const children: Component[] = [
      { render: () => [''], layout: { width: 'fill', height: 2, margin: { bottom: 1 } } },
      { render: () => [''], layout: { width: 'fill', height: 2, margin: { bottom: 1 } } },
    ];
    const scrollView = new ScrollView({ layout: { width: 'fill', height: 'fill' }, children });

    scrollView.render(ctx(10, 4));
    scrollView.scrollToBottom();

    expect(scrollView.scrollY).toBe(2);
  });

  it('does not render scrolled content over a later fixed footer', () => {
    const scrollView = new ScrollView({
      layout: { width: 'fill', height: 'fill' },
      focusable: false,
      children: [new Text({ text: 'chat\n'.repeat(20), layout: { width: 'fill', height: 20 } })],
    });
    scrollView.scrollTo(10);
    const footer = new Text({ text: 'footer', layout: { width: 'fill', height: 1 } });
    const root = new Box({
      layout: { width: 'fill', height: 'fill', direction: 'column' },
      children: [scrollView, footer],
    });
    const entries = layoutTree([root], { x: 0, y: 0, width: 10, height: 4 }, null, caps);
    const canvas = createCanvas(10, 4);

    for (const entry of sortForRender(entries)) drawEntry(canvas, entry, null, caps);

    expect(stripAnsi(canvasToLines(canvas)[3])).toBe('footer    ');
  });

  it('keeps fixed status and input chrome visible above scrolled transcript content', () => {
    const scrollView = new ScrollView({
      layout: { width: 'fill', height: 'fill' },
      focusable: false,
      children: [new Text({ text: 'chat\n'.repeat(30), layout: { width: 'fill', height: 30 } })],
    });
    scrollView.scrollTo(20);
    const transcriptBox = new Box({ layout: { width: 'fill', height: 'fill' }, children: [scrollView] });
    const status = new Text({ text: 'ready', layout: { width: 'fill', height: 1, zIndex: 10 } });
    const input = new Input({ placeholder: 'type a message...', layout: { width: 'fill', height: 1, zIndex: 10 } });
    const prompt = new Text({ text: '> ', layout: { width: 2, height: 1, zIndex: 10 } });
    const inputBox = new Box({
      layout: {
        width: 'fill',
        height: 2,
        direction: 'row',
        border: { top: true, right: false, bottom: false, left: false },
        zIndex: 10,
      },
      children: [prompt, input],
    });
    const root = new Box({
      layout: { width: 'fill', height: 'fill', direction: 'column' },
      children: [transcriptBox, status, inputBox],
    });
    const entries = layoutTree([root], { x: 0, y: 0, width: 20, height: 8 }, input, caps);
    const canvas = createCanvas(20, 8);

    for (const entry of sortForRender(entries)) drawEntry(canvas, entry, input, caps);

    const lines = canvasToLines(canvas).map(stripAnsi);
    expect(lines[5]).toBe('ready               ');
    expect(lines[6]).toBe('────────────────────');
    expect(lines[7]).toBe('>                   ');
  });

  it('clamps scroll after content shrinks before the next input event', () => {
    const scrollView = new ScrollView({
      layout: { width: 'fill', height: 'fill' },
      children: [new Text({ text: 'line\n'.repeat(20), layout: { width: 'fill', height: 20 } })],
    });
    scrollView.handleEvent(
      {
        type: 'key',
        kind: 'press',
        key: 'end',
        source: 'legacy',
        raw: '',
        shift: false,
        ctrl: false,
        alt: false,
        meta: false,
      },
      { rect: { x: 0, y: 0, width: 10, height: 4 }, contentRect: { x: 0, y: 0, width: 10, height: 4 }, focused: true },
    );
    scrollView.setChildren([new Text({ text: 'short', layout: { width: 'fill', height: 1 } })]);

    const root = new Box({ layout: { width: 'fill', height: 'fill' }, children: [scrollView] });
    const entries = layoutTree([root], { x: 0, y: 0, width: 10, height: 4 }, scrollView, caps);
    const innerEntry = entries.find((entry) => entry.component === scrollView.children[0]);

    expect(scrollView.scrollY).toBe(0);
    expect(innerEntry?.rect.y).toBe(0);
  });
});
