import { describe, expect, it } from 'vitest';

import { NO_MODIFIERS } from './events';
import type { InputEvent, MouseInputEvent } from './events';
import { InputRouter, type InputRouterHost } from './inputRouter';
import type { Component, SurfaceEntry } from './surface';

const wheel = (x: number, y: number): MouseInputEvent => ({
  ...NO_MODIFIERS,
  type: 'mouse',
  kind: 'wheel',
  button: 'wheelDown',
  x,
  y,
  coordinateSpace: 'cells',
  source: 'sgr',
  raw: '',
});

const hostWith = (entries: SurfaceEntry[]): InputRouterHost => ({
  getFocused: () => null,
  getEntries: () => entries,
  setTerminalFocused: () => {},
  getTerminalFocused: () => false,
  requestRender: () => {},
});

describe('InputRouter mouse propagation', () => {
  it('lets a wheel event fall through a clickable child to the scroller beneath', () => {
    const seen: string[] = [];
    const scroller: Component = {
      render: () => {},
      handleInput: () => {
        seen.push('scroller');
      },
    };
    const clickable: Component = {
      render: () => {},
      handleInput: (event: InputEvent) => {
        seen.push('clickable');
        if (event.type === 'mouse' && event.kind === 'press') return true;
        return false;
      },
    };
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    const router = new InputRouter(hostWith([
      { component: scroller, rect },
      { component: clickable, rect },
    ]));

    router.dispatchEvent(wheel(5, 5));

    expect(seen).toEqual(['clickable', 'scroller']);
  });

  it('stops at a clickable child that consumes the event', () => {
    const seen: string[] = [];
    const scroller: Component = {
      render: () => {},
      handleInput: () => {
        seen.push('scroller');
      },
    };
    const clickable: Component = {
      render: () => {},
      handleInput: () => {
        seen.push('clickable');
        return true;
      },
    };
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    const router = new InputRouter(hostWith([
      { component: scroller, rect },
      { component: clickable, rect },
    ]));

    router.dispatchEvent({ ...wheel(5, 5), kind: 'press', button: 'left' });

    expect(seen).toEqual(['clickable']);
  });
});
