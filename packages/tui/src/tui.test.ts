import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';

import { capability, createDefaultCapabilities } from './capabilities';
import type { InputEvent } from './events';
import { createOsc52Sequence } from './features/clipboard';
import { type KeyChord, keyMatches } from './keybinds';
import { eventToMouseEvent, parseInput } from './keyboard';
import { TerminalInputParser } from './parser';
import { TUI } from './tui';
import type { Component, Focusable, FocusableNavigation } from './types/component';
import { isFocusable, isFocusableNavigation } from './types/guards';
import type { Terminal } from './types/terminal';
import { sliceByColumn, stripAnsi, truncateToWidth, visibleWidth, wrapText } from './utils';

class CapturingTerminal implements Terminal {
  columns = 5;
  rows = 3;
  writes: string[] = [];

  write(data: string): void {
    this.writes.push(data);
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

describe('component guards', () => {
  it('detects focusable components', () => {
    const component: Focusable = {
      focused: true,
      render: () => [],
    };
    expect(isFocusable(component)).toBe(true);
    expect(isFocusable({ render: () => [] })).toBe(false);
    expect(isFocusable(null)).toBe(false);
  });

  it('detects focus navigation components', () => {
    const component: FocusableNavigation = {
      render: () => [],
      focusNext: () => null,
    };
    expect(isFocusableNavigation(component)).toBe(true);
    expect(isFocusableNavigation({ render: () => [] })).toBe(false);
  });

  it('accepts handleEvent on components', () => {
    const events: string[] = [];
    const component: Component = {
      render: () => [],
      handleEvent: (event) => events.push(event.type),
    };
    component.handleEvent?.(
      { type: 'text', text: 'hello', raw: 'hello' },
      { rect: { x: 0, y: 0, width: 1, height: 1 }, contentRect: { x: 0, y: 0, width: 1, height: 1 }, focused: true },
    );
    expect(events).toEqual(['text']);
  });
});

describe('TUI rendering', () => {
  it('does not use CRLF row advances during diff renders after full-width lines', () => {
    const terminal = new CapturingTerminal();
    const component: Component = {
      render: () => ['aaaaa', 'bbbbb', 'ccccc'],
    };
    const tui = new TUI(terminal, { synchronizedOutput: false });
    tui.addChild(component);

    (tui as unknown as { doRender: () => void }).doRender();
    component.render = () => ['aXaaa', 'bXbbb', 'ccccc'];
    (tui as unknown as { doRender: () => void }).doRender();

    const diffWrite = terminal.writes.at(-1) ?? '';
    expect(diffWrite).not.toContain('\r\n');
  });

  it('redraws from the saved anchor when rendered line count grows', () => {
    const terminal = new CapturingTerminal();
    const component: Component = {
      render: () => ['one', 'two'],
    };
    const tui = new TUI(terminal, { synchronizedOutput: false });
    tui.addChild(component);

    (tui as unknown as { doRender: () => void }).doRender();
    (tui as unknown as { doRender: () => void }).doRender();
    component.render = () => ['one', 'two', 'three'];
    (tui as unknown as { doRender: () => void }).doRender();

    const growthWrite = terminal.writes.at(-1) ?? '';
    expect(growthWrite.startsWith('\x1b8')).toBe(true);
    expect(growthWrite).toContain('\r\n');
    expect(growthWrite).toContain('\x1b7');
    expect(growthWrite).not.toContain('\x1b[2J');
  });

  it('lets input interceptors consume events before focus handling', () => {
    const terminal = new CapturingTerminal();
    let handled = 0;
    const component: Component = {
      render: () => [''],
      handleEvent: () => handled++,
    };
    const tui = new TUI(terminal, { synchronizedOutput: false });
    tui.addChild(component);
    tui.setFocus(component);
    tui.addInputInterceptor((event) => event.type === 'text');

    (tui as unknown as { dispatchEvent: (event: InputEvent) => void }).dispatchEvent({
      type: 'text',
      text: 'x',
      raw: 'x',
    });

    expect(handled).toBe(0);
  });
});

describe('parseInput', () => {
  it('parses printable keys with text payloads', () => {
    const event = parseInput('a');
    expect(event).toMatchObject({ type: 'key', key: 'a', text: 'a', source: 'legacy' });
  });

  it('parses committed multi-character text', () => {
    expect(parseInput('hello')).toEqual({ type: 'text', text: 'hello', raw: 'hello' });
  });

  it('parses control keys', () => {
    expect(parseInput('\r')).toMatchObject({ type: 'key', key: 'enter' });
    expect(parseInput('\x1b')).toMatchObject({ type: 'key', key: 'escape' });
    expect(parseInput('\t')).toMatchObject({ type: 'key', key: 'tab' });
    expect(parseInput('\x7f')).toMatchObject({ type: 'key', key: 'backspace' });
    expect(parseInput('\x01')).toMatchObject({ type: 'key', key: 'a', ctrl: true });
  });

  it('parses arrows and special keys', () => {
    expect(parseInput('\x1b[A')).toMatchObject({ type: 'key', key: 'up' });
    expect(parseInput('\x1b[B')).toMatchObject({ type: 'key', key: 'down' });
    expect(parseInput('\x1b[C')).toMatchObject({ type: 'key', key: 'right' });
    expect(parseInput('\x1b[D')).toMatchObject({ type: 'key', key: 'left' });
    expect(parseInput('\x1b[H')).toMatchObject({ type: 'key', key: 'home' });
    expect(parseInput('\x1b[F')).toMatchObject({ type: 'key', key: 'end' });
    expect(parseInput('\x1b[3~')).toMatchObject({ type: 'key', key: 'delete' });
  });

  it('parses function keys', () => {
    expect(parseInput('\x1bOP')).toMatchObject({ type: 'key', key: 'f1' });
    expect(parseInput('\x1b[15~')).toMatchObject({ type: 'key', key: 'f5' });
    expect(parseInput('\x1b[24~')).toMatchObject({ type: 'key', key: 'f12' });
  });

  it('parses modified xterm and CSI-u keys', () => {
    expect(parseInput('\x1b[1;5A')).toMatchObject({ type: 'key', key: 'up', ctrl: true });
    expect(parseInput('\x1b[97;5u')).toMatchObject({ type: 'key', key: 'a', ctrl: true, text: 'a' });
    expect(parseInput('\x1b[13;2u')).toMatchObject({ type: 'key', key: 'enter', shift: true });
    expect(parseInput('\x1b[27;5;13~')).toMatchObject({ type: 'key', key: 'enter', ctrl: true });
  });

  it('parses alt-prefixed input', () => {
    expect(parseInput('\x1ba')).toMatchObject({ type: 'key', key: 'a', alt: true, meta: true });
  });

  it('parses focus events', () => {
    expect(parseInput('\x1b[I')).toEqual({ type: 'focus', focused: true, raw: '\x1b[I' });
    expect(parseInput('\x1b[O')).toEqual({ type: 'focus', focused: false, raw: '\x1b[O' });
  });

  it('keeps unknown control sequences out of alt key handling', () => {
    expect(parseInput('\x1b]0;title\x07')).toMatchObject({ type: 'terminalResponse', sequence: 'osc' });
    expect(parseInput('\x1b[?1;2z')).toMatchObject({ type: 'terminalResponse', sequence: 'csi' });
  });

  it('parses SGR mouse events semantically', () => {
    expect(parseInput('\x1b[<0;10;5M')).toMatchObject({
      type: 'mouse',
      kind: 'press',
      button: 'left',
      x: 9,
      y: 4,
    });
    expect(parseInput('\x1b[<0;10;5m')).toMatchObject({ type: 'mouse', kind: 'release', button: 'left' });
    expect(parseInput('\x1b[<32;10;5M')).toMatchObject({ type: 'mouse', kind: 'drag', button: 'left' });
    expect(parseInput('\x1b[<33;10;5M')).toMatchObject({ type: 'mouse', kind: 'drag', button: 'middle' });
    expect(parseInput('\x1b[<35;10;5M')).toMatchObject({ type: 'mouse', kind: 'move', button: 'unknown' });
    expect(parseInput('\x1b[<64;10;5M')).toMatchObject({ type: 'mouse', kind: 'wheel', button: 'wheelUp' });
  });

  it('converts mouse events to the compatibility mouse type', () => {
    const event = parseInput('\x1b[<64;10;5M');
    expect(eventToMouseEvent(event)).toMatchObject({ button: 'scrollUp', motion: 'press' });
  });
});

describe('TerminalInputParser', () => {
  it('buffers split CSI sequences', () => {
    const parser = new TerminalInputParser();
    expect(parser.feed('\x1b[')).toEqual([]);
    expect(parser.feed('A')).toMatchObject([{ type: 'key', key: 'up' }]);
  });

  it('flushes incomplete control sequences after caller timeout', () => {
    const parser = new TerminalInputParser();
    expect(parser.feed('\x1b[')).toEqual([]);
    expect(parser.hasPending()).toBe(true);
    expect(parser.flushPending()).toMatchObject([{ type: 'terminalResponse', sequence: 'csi' }]);
  });

  it('bounds unterminated control payloads', () => {
    const parser = new TerminalInputParser({ maxBufferBytes: 8 });
    expect(parser.feed('\x1b]0;this is too long')).toMatchObject([{ type: 'terminalResponse', sequence: 'unknown' }]);
  });

  it('emits bracketed paste as data', () => {
    const parser = new TerminalInputParser();
    expect(parser.feed('\x1b[200~hello')).toEqual([]);
    expect(parser.feed('\nworld\x1b[201~')).toEqual([
      { type: 'paste', text: 'hello\nworld', raw: '\x1b[200~hello\nworld\x1b[201~' },
    ]);
  });
});

describe('keyMatches', () => {
  it('matches key events only', () => {
    const chord: KeyChord = { key: 'up' };
    expect(
      keyMatches(chord, {
        type: 'key',
        key: 'up',
        kind: 'press',
        source: 'legacy',
        raw: '',
        shift: false,
        ctrl: false,
        alt: false,
        meta: false,
      }),
    ).toBe(true);
    expect(keyMatches(chord, { type: 'text', text: 'up', raw: 'up' })).toBe(false);
  });

  it('matches strict modifiers', () => {
    const chord: KeyChord = { key: 's', ctrl: true };
    expect(
      keyMatches(chord, {
        type: 'key',
        key: 's',
        kind: 'press',
        source: 'legacy',
        raw: '',
        shift: false,
        ctrl: true,
        alt: false,
        meta: false,
      }),
    ).toBe(true);
    expect(
      keyMatches(chord, {
        type: 'key',
        key: 's',
        kind: 'press',
        source: 'legacy',
        raw: '',
        shift: true,
        ctrl: true,
        alt: false,
        meta: false,
      }),
    ).toBe(false);
  });
});

describe('capabilities and features', () => {
  it('creates conservative defaults from env', () => {
    const caps = createDefaultCapabilities({ TERM: 'xterm-256color', COLORTERM: 'truecolor' });
    expect(caps.colors.palette256.value).toBe(true);
    expect(caps.colors.truecolor.value).toBe(true);
    expect(caps.input.legacy.value).toBe(true);
  });

  it('creates OSC 52 sequences with payload limits', () => {
    const seq = createOsc52Sequence('ok', { terminator: 'st' });
    expect(seq.startsWith('\x1b]52;c;')).toBe(true);
    expect(seq.endsWith('\x1b\\')).toBe(true);
    expect(() => createOsc52Sequence('too long', { maxPayloadBytes: 4 })).toThrow();
  });

  it('allows manual capability patches', () => {
    expect(capability(true, 'configured')).toEqual({ value: true, source: 'configured' });
  });
});

describe('text utilities', () => {
  it('strips ANSI and measures visible width', () => {
    expect(stripAnsi('\x1b[31mRed\x1b[0m')).toBe('Red');
    expect(visibleWidth('\x1b[31m你好\x1b[0m')).toBe(4);
    expect(visibleWidth('😀')).toBe(2);
  });

  it('truncates and wraps text', () => {
    const truncated = truncateToWidth('Hello World', 8);
    expect(visibleWidth(truncated)).toBe(8);
    const wrapped = wrapText('Hello World Foo Bar', 10);
    expect(wrapped.length).toBeGreaterThan(1);
    for (const line of wrapped) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(10);
    }
  });

  it('truncates and slices after leading ANSI codes', () => {
    const styled = '\x1b[31mHello World\x1b[0m';
    expect(stripAnsi(truncateToWidth(styled, 8))).toBe('Hello W…');
    expect(stripAnsi(sliceByColumn(styled, 0, 5))).toBe('Hello');
  });

  it('slices by visible columns', () => {
    expect(sliceByColumn('Hello World', 6, 11)).toBe('World');
    expect(sliceByColumn('你好世界', 0, 2)).toBe('你');
  });
});
