/**
 * Xterm SGR mouse-wheel support for the TUI.
 *
 * Mouse tracking is enabled on demand (when the viewport mounts) and disabled
 * on unmount. We use the SGR encoding (`?1006`) plus normal button-event
 * tracking (`?1000`) which together emit
 *
 *     ESC [ < Cb ; Cx ; Cy M    (button press / motion / wheel)
 *     ESC [ < Cb ; Cx ; Cy m    (button release; not used here)
 *
 * For wheel events:
 *   Cb = 64  → wheel up
 *   Cb = 65  → wheel down
 * (modifier bits — shift/meta/ctrl — are masked off; we don't care about them.)
 *
 * Installation strategy: Ink consumes stdin via the `'readable'` event and
 * `stdin.read()` (not the `'data'` event), so a `data` listener can't be
 * used to filter. Instead we monkey-patch `stdin.read` itself: every chunk
 * returned to Ink is passed through `filterMouseSequences`, which dispatches
 * wheel events to our handler and strips the SGR mouse bytes from the
 * downstream payload. Without this, the escape bytes would leak into the
 * prompt as literal text.
 *
 * Cross-chunk handling: an SGR sequence can be split across two chunks. We
 * buffer any incomplete trailing prefix and prepend it to the next chunk so
 * a sequence is only ever emitted to Ink (stripped) when complete.
 */

const ENABLE = '\u001B[?1000h\u001B[?1006h';
const DISABLE = '\u001B[?1006l\u001B[?1000l';

export interface MouseWheelHandler {
  onWheelUp: () => void;
  onWheelDown: () => void;
}

const ESC = '\u001B';
const SGR_PREFIX = '\u001B[<';
// Modifier bits in the Cb byte (shift=4, meta=8, ctrl=16). Mask them out
// before comparing to known button codes.
const MODIFIER_BITS = 0b11100;
const BUTTON_MASK = ~MODIFIER_BITS & 0xff;
const WHEEL_UP = 64;
const WHEEL_DOWN = 65;

interface SgrRecord {
  /** Index of the SGR_PREFIX in the chunk. */
  start: number;
  /** Index of the terminator ('M' or 'm') in the chunk. */
  end: number;
  /** Whether the terminator is 'M' (press) versus 'm' (release). */
  press: boolean;
  /** Parsed Cb value (first param). NaN if unparseable. */
  cb: number;
}

/** Locate the next SGR mouse record starting at or after `from`. */
function findNextSgr(chunk: string, from: number): SgrRecord | null {
  const start = chunk.indexOf(SGR_PREFIX, from);
  if (start === -1) return null;
  for (let j = start + SGR_PREFIX.length; j < chunk.length; j++) {
    const c = chunk.charCodeAt(j);
    if (c === 0x4d || c === 0x6d) {
      const params = chunk.slice(start + SGR_PREFIX.length, j);
      const cbStr = params.split(';')[0] ?? '';
      return { start, end: j, press: c === 0x4d, cb: Number.parseInt(cbStr, 10) };
    }
  }
  return null;
}

function dispatchSgr(rec: SgrRecord, handler: MouseWheelHandler): void {
  if (!(rec.press && Number.isFinite(rec.cb))) return;
  const button = rec.cb & BUTTON_MASK;
  if (button === WHEEL_UP) handler.onWheelUp();
  else if (button === WHEEL_DOWN) handler.onWheelDown();
}

/**
 * Parse a chunk for SGR mouse wheel events and dispatch the corresponding
 * handler. Exported for tests.
 */
export function parseChunk(chunk: string, handler: MouseWheelHandler): void {
  let i = 0;
  while (i < chunk.length) {
    const rec = findNextSgr(chunk, i);
    if (!rec) return;
    dispatchSgr(rec, handler);
    i = rec.end + 1;
  }
}

/**
 * Find the start index of any trailing **incomplete** SGR mouse prefix in
 * `chunk` (a `\x1b[<…` without a terminator yet). Returns `-1` if there is
 * none. Used to defer partial sequences until the next chunk arrives.
 *
 * We're conservative: any trailing `\x1b` or `\x1b[` or `\x1b[<…` (with no
 * `M`/`m` after) is treated as incomplete so it doesn't leak as text.
 */
function findTrailingIncomplete(chunk: string): number {
  // Quick reject.
  const lastEsc = chunk.lastIndexOf(ESC);
  if (lastEsc === -1) return -1;
  const tail = chunk.slice(lastEsc);
  // Cases: "ESC" alone, "ESC[" alone, "ESC[<…" with no terminator.
  if (tail === ESC) return lastEsc;
  if (tail === `${ESC}[`) return lastEsc;
  if (tail.startsWith(SGR_PREFIX)) {
    // Look for a terminator in the tail.
    for (let j = SGR_PREFIX.length; j < tail.length; j++) {
      const c = tail.charCodeAt(j);
      if (c === 0x4d || c === 0x6d) return -1; // complete; nothing trailing
    }
    return lastEsc;
  }
  return -1;
}

export interface FilterResult {
  /** Chunk with all complete SGR mouse sequences stripped. */
  cleaned: string;
  /** Any trailing incomplete SGR prefix to carry over to the next chunk. */
  carry: string;
}

/**
 * Walk `chunk` extracting mouse-wheel events (dispatched to `handler`) and
 * returning the chunk with all SGR mouse sequences removed, plus any
 * incomplete trailing prefix to carry over to the next chunk.
 *
 * Exported for tests.
 */
export function filterMouseSequences(chunk: string, handler: MouseWheelHandler): FilterResult {
  if (!chunk.includes(ESC)) return { cleaned: chunk, carry: '' };
  let working = chunk;
  let carry = '';
  const tailStart = findTrailingIncomplete(working);
  if (tailStart !== -1) {
    carry = working.slice(tailStart);
    working = working.slice(0, tailStart);
  }
  if (!working.includes(SGR_PREFIX)) return { cleaned: working, carry };
  let out = '';
  let i = 0;
  while (i < working.length) {
    const rec = findNextSgr(working, i);
    if (!rec) {
      out += working.slice(i);
      break;
    }
    out += working.slice(i, rec.start);
    dispatchSgr(rec, handler);
    i = rec.end + 1;
  }
  return { cleaned: out, carry };
}

/**
 * Turn on xterm mouse tracking and forward wheel events to the supplied
 * handler. Returns a disable function that restores the previous state.
 *
 * Safe to call when stdin is not a TTY: it becomes a no-op so unit tests
 * and non-interactive runs are unaffected.
 */
export function enableMouseWheel(handler: MouseWheelHandler): () => void {
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!(stdout.isTTY && stdin.isTTY)) {
    return () => {
      /* no-op */
    };
  }
  try {
    stdout.write(ENABLE);
  } catch {
    return () => {
      /* no-op */
    };
  }

  // Carry buffer for SGR sequences split across chunks.
  let carry = '';

  // Monkey-patch `stdin.read`: Ink uses readable-stream mode and pulls
  // chunks via `read()`, not via the 'data' event. We intercept here so
  // every chunk Ink consumes has mouse bytes filtered out.
  type ReadFn = (size?: number) => Buffer | string | null;
  const originalRead = stdin.read.bind(stdin) as ReadFn;
  const patchedRead = (size?: number): Buffer | string | null => {
    const raw = originalRead(size);
    if (raw === null) {
      // No data available. If we have a partial carry that turned out not to
      // be the start of a sequence, we can't know yet — leave it buffered.
      return null;
    }
    const isString = typeof raw === 'string';
    const text = isString ? (raw as string) : (raw as Buffer).toString('utf8');
    const combined = carry + text;
    const { cleaned, carry: nextCarry } = filterMouseSequences(combined, handler);
    carry = nextCarry;
    // Return an empty payload (not null) so Ink's read-loop continues.
    // `inputParserRef.current.push(emptyBuffer)` is a safe no-op in Ink.
    if (isString) return cleaned;
    return Buffer.from(cleaned, 'utf8');
  };
  (stdin as unknown as { read: ReadFn }).read = patchedRead;

  return () => {
    const current = (stdin as unknown as { read: ReadFn }).read;
    if (current === patchedRead) {
      (stdin as unknown as { read: ReadFn }).read = originalRead;
    }
    try {
      stdout.write(DISABLE);
    } catch {
      /* ignore */
    }
  };
}
