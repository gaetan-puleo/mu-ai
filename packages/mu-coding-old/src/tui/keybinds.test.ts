import { afterEach, describe, expect, it } from 'bun:test';
import type { Key } from 'ink';
import { type KeyChord, keyMatches, TUI_KEYBINDS } from './keybinds';

afterEach(() => {
  TUI_KEYBINDS.reset();
});

/** Build a fully-populated Ink Key with every flag default-false. */
function mkKey(overrides: Partial<Key> = {}): Key {
  const base: Key = {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    // Some Ink versions expose `home`/`end` on Key; cast through unknown
    // so older typings don't complain.
  } as Key;
  return { ...(base as object), ...(overrides as object) } as Key;
}

describe('keyMatches', () => {
  it('matches an exact Shift+Tab chord', () => {
    const chord: KeyChord = { shift: true, tab: true };
    expect(keyMatches(chord, '', mkKey({ shift: true, tab: true }))).toBe(true);
  });

  it('rejects Tab without Shift when chord requires Shift+Tab', () => {
    const chord: KeyChord = { shift: true, tab: true };
    expect(keyMatches(chord, '', mkKey({ tab: true }))).toBe(false);
  });

  it('rejects an extra modifier (strict match)', () => {
    const chord: KeyChord = { shift: true, tab: true };
    expect(keyMatches(chord, '', mkKey({ shift: true, tab: true, ctrl: true }))).toBe(false);
  });

  it('matches a pure char chord', () => {
    const chord: KeyChord = { char: 'a' };
    expect(keyMatches(chord, 'a', mkKey())).toBe(true);
    expect(keyMatches(chord, 'b', mkKey())).toBe(false);
  });

  it('char chord rejects when any modifier is set', () => {
    const chord: KeyChord = { char: 'a' };
    expect(keyMatches(chord, 'a', mkKey({ ctrl: true }))).toBe(false);
  });

  it('matches Ctrl+letter (char + ctrl modifier)', () => {
    const chord: KeyChord = { char: 'k', ctrl: true };
    expect(keyMatches(chord, 'k', mkKey({ ctrl: true }))).toBe(true);
    expect(keyMatches(chord, 'k', mkKey())).toBe(false);
    expect(keyMatches(chord, 'k', mkKey({ ctrl: true, shift: true }))).toBe(false);
  });

  it('ignores input when chord has no char', () => {
    const chord: KeyChord = { escape: true };
    expect(keyMatches(chord, 'noise', mkKey({ escape: true }))).toBe(true);
  });
});

describe('TUI_KEYBINDS.register / list', () => {
  it('starts empty', () => {
    expect(TUI_KEYBINDS.size()).toBe(0);
    expect(TUI_KEYBINDS.list()).toEqual([]);
  });

  it('preserves registration order', () => {
    const a = { chord: { tab: true }, description: 'a', run: () => true };
    const b = { chord: { escape: true }, description: 'b', run: () => true };
    TUI_KEYBINDS.register(a);
    TUI_KEYBINDS.register(b);
    expect(TUI_KEYBINDS.list()).toEqual([a, b]);
  });

  it('detacher removes only its own handler', () => {
    const a = { chord: { tab: true }, description: 'a', run: () => true };
    const b = { chord: { escape: true }, description: 'b', run: () => true };
    const offA = TUI_KEYBINDS.register(a);
    TUI_KEYBINDS.register(b);
    offA();
    expect(TUI_KEYBINDS.list()).toEqual([b]);
  });
});

describe('TUI_KEYBINDS.subscribe / notify', () => {
  it('notifies on register and unregister', () => {
    let calls = 0;
    TUI_KEYBINDS.subscribe(() => {
      calls++;
    });
    const off = TUI_KEYBINDS.register({
      chord: { tab: true },
      description: '',
      run: () => true,
    });
    expect(calls).toBe(1);
    off();
    expect(calls).toBe(2);
  });

  it('subscribe returns a disposer', () => {
    let calls = 0;
    const off = TUI_KEYBINDS.subscribe(() => {
      calls++;
    });
    off();
    TUI_KEYBINDS.register({ chord: { tab: true }, description: '', run: () => true });
    expect(calls).toBe(0);
  });

  it('listener errors do not break notify', () => {
    TUI_KEYBINDS.subscribe(() => {
      throw new Error('boom');
    });
    let other = 0;
    TUI_KEYBINDS.subscribe(() => {
      other++;
    });
    TUI_KEYBINDS.register({ chord: { tab: true }, description: '', run: () => true });
    expect(other).toBe(1);
  });
});

describe('TUI_KEYBINDS.reset', () => {
  it('clears handlers', () => {
    TUI_KEYBINDS.register({ chord: { tab: true }, description: '', run: () => true });
    TUI_KEYBINDS.reset();
    expect(TUI_KEYBINDS.size()).toBe(0);
  });
});
