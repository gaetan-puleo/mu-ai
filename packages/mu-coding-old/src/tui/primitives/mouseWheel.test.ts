import { describe, expect, it } from 'bun:test';
import { filterMouseSequences, parseChunk } from './mouseWheel';

function makeHandler(): { up: number; down: number; onWheelUp: () => void; onWheelDown: () => void } {
  const h = {
    up: 0,
    down: 0,
    onWheelUp(): void {
      h.up += 1;
    },
    onWheelDown(): void {
      h.down += 1;
    },
  };
  return h;
}

describe('parseChunk', () => {
  it('detects a single wheel-up event', () => {
    const h = makeHandler();
    parseChunk('\u001B[<64;10;5M', h);
    expect(h.up).toBe(1);
    expect(h.down).toBe(0);
  });

  it('detects a single wheel-down event', () => {
    const h = makeHandler();
    parseChunk('\u001B[<65;10;5M', h);
    expect(h.up).toBe(0);
    expect(h.down).toBe(1);
  });

  it('ignores modifier bits (shift/ctrl/meta) on the button byte', () => {
    const h = makeHandler();
    // 64 | 0x10 (ctrl) = 80
    parseChunk('\u001B[<80;1;1M', h);
    expect(h.up).toBe(1);
  });

  it('ignores release events (terminator m)', () => {
    const h = makeHandler();
    parseChunk('\u001B[<64;10;5m', h);
    expect(h.up).toBe(0);
    expect(h.down).toBe(0);
  });

  it('parses multiple events in a single chunk', () => {
    const h = makeHandler();
    parseChunk('\u001B[<64;1;1M\u001B[<65;1;1M\u001B[<65;1;1M', h);
    expect(h.up).toBe(1);
    expect(h.down).toBe(2);
  });

  it('drops incomplete sequences silently', () => {
    const h = makeHandler();
    parseChunk('\u001B[<64;10;5', h);
    expect(h.up).toBe(0);
    expect(h.down).toBe(0);
  });

  it('ignores non-wheel button events (e.g. mouse click)', () => {
    const h = makeHandler();
    parseChunk('\u001B[<0;10;5M', h); // left button press
    expect(h.up).toBe(0);
    expect(h.down).toBe(0);
  });

  it('does nothing when no SGR sequence is present', () => {
    const h = makeHandler();
    parseChunk('hello world', h);
    parseChunk('\u001B[A', h); // up arrow CSI but not SGR mouse
    expect(h.up).toBe(0);
    expect(h.down).toBe(0);
  });

  it('handles a chunk with surrounding text', () => {
    const h = makeHandler();
    parseChunk('garbage\u001B[<65;5;5Mmore', h);
    expect(h.down).toBe(1);
  });
});

describe('filterMouseSequences', () => {
  it('returns input unchanged when no SGR prefix is present', () => {
    const h = makeHandler();
    expect(filterMouseSequences('hello', h)).toEqual({ cleaned: 'hello', carry: '' });
    expect(h.up).toBe(0);
    expect(h.down).toBe(0);
  });

  it('strips a wheel-up sequence and dispatches the handler', () => {
    const h = makeHandler();
    expect(filterMouseSequences('\u001B[<64;10;5M', h)).toEqual({ cleaned: '', carry: '' });
    expect(h.up).toBe(1);
  });

  it('strips a release sequence without dispatching', () => {
    const h = makeHandler();
    expect(filterMouseSequences('\u001B[<0;10;5m', h)).toEqual({ cleaned: '', carry: '' });
    expect(h.up).toBe(0);
    expect(h.down).toBe(0);
  });

  it('preserves surrounding text', () => {
    const h = makeHandler();
    expect(filterMouseSequences('before\u001B[<64;1;1Mmiddle\u001B[<65;1;1Mend', h)).toEqual({
      cleaned: 'beforemiddleend',
      carry: '',
    });
    expect(h.up).toBe(1);
    expect(h.down).toBe(1);
  });

  it('matches the user-reported leaky chunk and dispatches all wheel events', () => {
    const h = makeHandler();
    const chunk =
      '\u001B[<64;61;20M\u001B[<64;61;20M\u001B[<64;61;20M\u001B[<64;61;20M' +
      '\u001B[<65;61;20M\u001B[<64;53;30M\u001B[<64;53;30M\u001B[<65;53;30M';
    expect(filterMouseSequences(chunk, h)).toEqual({ cleaned: '', carry: '' });
    expect(h.up).toBe(6);
    expect(h.down).toBe(2);
  });

  it('does not strip non-SGR escape sequences (e.g. arrow keys)', () => {
    const h = makeHandler();
    expect(filterMouseSequences('\u001B[A', h)).toEqual({ cleaned: '\u001B[A', carry: '' });
  });

  it('carries over an incomplete SGR sequence to the next chunk', () => {
    const h = makeHandler();
    expect(filterMouseSequences('\u001B[<64;', h)).toEqual({ cleaned: '', carry: '\u001B[<64;' });
    expect(h.up).toBe(0);
  });

  it('carries over a bare ESC at end of chunk', () => {
    const h = makeHandler();
    expect(filterMouseSequences('hello\u001B', h)).toEqual({ cleaned: 'hello', carry: '\u001B' });
  });

  it('carries over a bare ESC[ at end of chunk', () => {
    const h = makeHandler();
    expect(filterMouseSequences('hello\u001B[', h)).toEqual({ cleaned: 'hello', carry: '\u001B[' });
  });

  it('completes an SGR sequence split across two chunks (full round trip)', () => {
    const h = makeHandler();
    const r1 = filterMouseSequences('\u001B[<64;', h);
    expect(r1.cleaned).toBe('');
    expect(h.up).toBe(0);
    const r2 = filterMouseSequences(`${r1.carry}10;5M`, h);
    expect(r2.cleaned).toBe('');
    expect(r2.carry).toBe('');
    expect(h.up).toBe(1);
  });

  it('does not treat completed SGR + text as incomplete tail', () => {
    const h = makeHandler();
    // A completed sequence followed by text — no carry.
    expect(filterMouseSequences('\u001B[<64;1;1Mhi', h)).toEqual({ cleaned: 'hi', carry: '' });
    expect(h.up).toBe(1);
  });
});
