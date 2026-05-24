import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';

import { Box } from './components/Box';
import { Modal } from './components/Modal';
import { Text } from './components/Text';
import { createDefaultCapabilities } from './capabilities';
import { layoutTree, sortForRender } from './layout/engine';
import { cellBufferToLines, createCellBuffer } from './layout/cellbuffer';
import { drawEntry } from './layout/render';
import { stripAnsi } from './utils';

const caps = createDefaultCapabilities();

describe('render pipeline smoke', () => {
  it('plain text on default background emits no SGR (terminal styling preserved)', () => {
    const text = new Text({ text: 'Hello world', layout: { width: 11, height: 1 } });
    const entries = layoutTree([text], { x: 0, y: 0, width: 20, height: 1 }, null, caps);
    const buf = createCellBuffer(20, 1);
    for (const e of sortForRender(entries)) drawEntry(buf, e, null, caps);
    const line = cellBufferToLines(buf)[0];

    // The text should be visible without any ANSI escape codes — that means
    // the terminal's own default colors will apply (no surprise black bg
    // showing up on light terminals).
    expect(line).toBe('Hello world         ');
    expect(stripAnsi(line)).toBe('Hello world         ');
  });

  it('text inside a colored Box gets the box bg', () => {
    const text = new Text({ text: 'Hi', layout: { width: 2, height: 1 } });
    const box = new Box({
      layout: { width: 10, height: 1, backgroundColor: '#112233' },
      children: [text],
    });
    const entries = layoutTree([box], { x: 0, y: 0, width: 10, height: 1 }, null, caps);
    const buf = createCellBuffer(10, 1);
    for (const e of sortForRender(entries)) drawEntry(buf, e, null, caps);
    const line = cellBufferToLines(buf)[0];

    expect(line).toContain('48;2;17;34;51'); // #112233
    expect(stripAnsi(line)).toContain('Hi');
  });

  it('modal blends a dimmer over underlying content', () => {
    const underlying = new Box({
      layout: { width: 'fill', height: 'fill', backgroundColor: '#00c8c8' }, // cyan
    });
    const modal = new Modal({ title: 'X', body: 'Y', width: 6, height: 3 });
    const entries = layoutTree([underlying, modal], { x: 0, y: 0, width: 20, height: 5 }, modal, caps);
    const buf = createCellBuffer(20, 5);
    for (const e of sortForRender(entries)) drawEntry(buf, e, modal, caps);
    const lines = cellBufferToLines(buf);

    // Default 50% black backdrop over cyan (#00c8c8 = 0,200,200) → (0,100,100).
    const hasBlendedBackdrop = lines.some((l) => l.includes('48;2;0;100;100'));
    expect(hasBlendedBackdrop).toBe(true);
  });
});
