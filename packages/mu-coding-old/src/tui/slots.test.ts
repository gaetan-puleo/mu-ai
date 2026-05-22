import { afterEach, describe, expect, it } from 'bun:test';
import { TUI_SLOTS } from './slots';

afterEach(() => {
  TUI_SLOTS.reset();
});

describe('TUI_SLOTS.register', () => {
  it('starts with no contributors', () => {
    expect(TUI_SLOTS.size('assistantLine')).toBe(0);
    expect(TUI_SLOTS.render('assistantLine')).toEqual([]);
  });

  it('renders contributors in registration order', () => {
    TUI_SLOTS.register('assistantLine', () => 'first');
    TUI_SLOTS.register('assistantLine', () => 'second');
    expect(TUI_SLOTS.render('assistantLine')).toEqual(['first', 'second']);
  });

  it('detacher removes only its own contributor', () => {
    const offA = TUI_SLOTS.register('s', () => 'A');
    TUI_SLOTS.register('s', () => 'B');
    offA();
    expect(TUI_SLOTS.render('s')).toEqual(['B']);
    expect(TUI_SLOTS.size('s')).toBe(1);
  });

  it('detaching the last contributor drops the slot entry', () => {
    const off = TUI_SLOTS.register('s', () => 'only');
    off();
    expect(TUI_SLOTS.size('s')).toBe(0);
    expect(TUI_SLOTS.render('s')).toEqual([]);
  });

  it('isolates slots by id', () => {
    TUI_SLOTS.register('a', () => 'in-a');
    TUI_SLOTS.register('b', () => 'in-b');
    expect(TUI_SLOTS.render('a')).toEqual(['in-a']);
    expect(TUI_SLOTS.render('b')).toEqual(['in-b']);
  });
});

describe('TUI_SLOTS.subscribe / notify', () => {
  it('notifies listeners on register', () => {
    let calls = 0;
    TUI_SLOTS.subscribe(() => {
      calls++;
    });
    TUI_SLOTS.register('s', () => 'x');
    expect(calls).toBe(1);
  });

  it('notifies listeners on unregister', () => {
    const off = TUI_SLOTS.register('s', () => 'x');
    let calls = 0;
    TUI_SLOTS.subscribe(() => {
      calls++;
    });
    off();
    expect(calls).toBe(1);
  });

  it('notifies listeners on notify()', () => {
    let calls = 0;
    TUI_SLOTS.subscribe(() => {
      calls++;
    });
    TUI_SLOTS.notify();
    TUI_SLOTS.notify();
    expect(calls).toBe(2);
  });

  it('subscribe returns a disposer that detaches the listener', () => {
    let calls = 0;
    const off = TUI_SLOTS.subscribe(() => {
      calls++;
    });
    off();
    TUI_SLOTS.notify();
    expect(calls).toBe(0);
  });

  it('listener errors do not break notify', () => {
    TUI_SLOTS.subscribe(() => {
      throw new Error('boom');
    });
    let other = 0;
    TUI_SLOTS.subscribe(() => {
      other++;
    });
    TUI_SLOTS.notify();
    expect(other).toBe(1);
  });
});

describe('TUI_SLOTS.render — re-evaluates contributors each call', () => {
  it('contributor function runs on every render', () => {
    let counter = 0;
    TUI_SLOTS.register('s', () => `${++counter}`);
    expect(TUI_SLOTS.render('s')).toEqual(['1']);
    expect(TUI_SLOTS.render('s')).toEqual(['2']);
  });

  it('contributors can return null to opt out (host filters)', () => {
    TUI_SLOTS.register('s', () => null);
    TUI_SLOTS.register('s', () => 'visible');
    // render() does NOT filter — that's useSlot's job.
    expect(TUI_SLOTS.render('s')).toEqual([null, 'visible']);
  });
});
