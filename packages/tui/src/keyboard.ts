import type { Buffer } from 'node:buffer';
import process from 'node:process';

import { type InputEvent, type KeyInputEvent, type Modifiers, type MouseInputEvent, NO_MODIFIERS } from './events';
import type { MouseEvent } from './types/mouse';

export type KeyEvent = KeyInputEvent;

// CSI-u / Kitty-like keyboard event: ESC [ code ; modifiers u, with optional Kitty subfields.
// deno-lint-ignore no-control-regex
const CSI_U_RE = /^\x1b\[(\d+)(?::[\d:]+)?(?:;(\d+(?::\d+)?))?(?:;([\d:]+))?u$/;
// Historical parser compatibility for older CSI-u-like encodings: ESC [ < code ; modifiers u.
// deno-lint-ignore no-control-regex
const LEGACY_KITTY_RE = /^\x1b\[<(\d+);(\d+)u$/;
// xterm modifyOtherKeys family. Terminals disagree on parameter order, so decode both common shapes.
// deno-lint-ignore no-control-regex
const XTERM_MODIFIED_RE = /^\x1b\[27;(\d+);(\d+)~$/;
// SGR mouse: ESC [ < Cb ; Cx ; Cy M / m.
// deno-lint-ignore no-control-regex
const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;
// Basic CSI keys: ESC [ code ~.
// deno-lint-ignore no-control-regex
const CSI_TILDE_RE = /^\x1b\[([0-9;]*)~$/;
// CSI keys with final letters: arrows, Home/End, focus reports.
// deno-lint-ignore no-control-regex
const CSI_KEY_RE = /^\x1b\[([0-9;]*)([A-HIOPR])$/;
// SS3 function/application cursor keys: ESC O P, ESC O A, etc.
// deno-lint-ignore no-control-regex
const SS3_RE = /^\x1bO([A-DFHPQS])$/;
// Alt-prefixed printable/control input.
// deno-lint-ignore no-control-regex
const ALT_PREFIX_RE = /^\x1b(.+)$/;
// Ctrl+A-Z: single byte 0x01-0x1a.
// deno-lint-ignore no-control-regex
const CTRL_RE = /^[\x01-\x1a]$/;

const CSI_KEY_MAP: Record<string, string> = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end',
  P: 'f1',
  Q: 'f2',
  R: 'f3',
  1: 'home',
  2: 'insert',
  3: 'delete',
  4: 'end',
  5: 'pageUp',
  6: 'pageDown',
};

const CSI_NUM_KEY_MAP: Record<string, string> = {
  11: 'f1',
  12: 'f2',
  13: 'f3',
  14: 'f4',
  15: 'f5',
  17: 'f6',
  18: 'f7',
  19: 'f8',
  20: 'f9',
  21: 'f10',
  23: 'f11',
  24: 'f12',
};

const SS3_KEY_MAP: Record<string, string> = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end',
  P: 'f1',
  Q: 'f2',
  R: 'f3',
  S: 'f4',
};

export function eventToMouseEvent(event: InputEvent | null): MouseEvent | null {
  if (event?.type !== 'mouse') return null;

  const button = event.button === 'wheelUp'
    ? 'scrollUp'
    : event.button === 'wheelDown'
    ? 'scrollDown'
    : event.button === 'middle' || event.button === 'right' || event.button === 'left'
    ? event.button
    : 'left';

  return {
    x: event.x,
    y: event.y,
    button,
    motion: event.kind === 'move' ? 'motion' : event.kind === 'wheel' ? 'press' : event.kind,
    shift: event.shift,
    ctrl: event.ctrl,
    meta: event.meta,
  };
}

export function parseInput(raw: string): InputEvent | null {
  if (raw.length === 0) return null;

  if (raw === '\r' || raw === '\n') {
    return key('enter', { raw, source: 'legacy' });
  }

  if (raw === '\x1b') {
    return key('escape', { raw, source: 'legacy' });
  }

  if (raw === '\t') {
    return key('tab', { raw, source: 'legacy' });
  }

  if (raw === '\x7f' || raw === '\b') {
    return key('backspace', { raw, source: 'legacy' });
  }

  if (CTRL_RE.test(raw)) {
    const code = raw.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13) return null;
    return key(String.fromCharCode(code + 96), { raw, source: 'legacy', ctrl: true });
  }

  const mouseMatch = raw.match(SGR_MOUSE_RE);
  if (mouseMatch) {
    return parseSgrMouse(raw, mouseMatch);
  }

  if (raw === '\x1b[I') {
    return { type: 'focus', focused: true, raw };
  }

  if (raw === '\x1b[O') {
    return { type: 'focus', focused: false, raw };
  }

  const csiUMatch = raw.match(CSI_U_RE);
  if (csiUMatch) {
    const code = Number.parseInt(csiUMatch[1], 10);
    const encodedModifiers = csiUMatch[2] ? Number.parseInt(csiUMatch[2], 10) : 1;
    const modifiers = decodeEncodedModifiers(encodedModifiers);
    const eventType = decodeKittyEventType(csiUMatch[2]);
    return key(codepointToKey(code), {
      ...modifiers,
      kind: eventType,
      raw,
      source: 'csi-u',
      text: codepointToText(code),
    });
  }

  const legacyKittyMatch = raw.match(LEGACY_KITTY_RE);
  if (legacyKittyMatch) {
    const code = Number.parseInt(legacyKittyMatch[1], 10);
    const modifiers = decodeEncodedModifiers(Number.parseInt(legacyKittyMatch[2], 10));
    return key(codepointToKey(code), { ...modifiers, raw, source: 'kitty', text: codepointToText(code) });
  }

  const xtermMatch = raw.match(XTERM_MODIFIED_RE);
  if (xtermMatch) {
    const first = Number.parseInt(xtermMatch[1], 10);
    const second = Number.parseInt(xtermMatch[2], 10);
    const modifierParam = first <= 8 && second > 8 ? first : second;
    const code = first <= 8 && second > 8 ? second : first;
    const modifiers = decodeEncodedModifiers(modifierParam);
    return key(codepointToKey(code), { ...modifiers, raw, source: 'xterm', text: codepointToText(code) });
  }

  const csiTildeMatch = raw.match(CSI_TILDE_RE);
  if (csiTildeMatch) {
    const params = splitParams(csiTildeMatch[1]);
    const keyName = params.length > 0 ? (CSI_NUM_KEY_MAP[params[0]] ?? CSI_KEY_MAP[params[0]]) : undefined;
    if (keyName) {
      return key(keyName, { ...decodeOptionalModifier(params[1]), raw, source: 'xterm' });
    }
  }

  const csiMatch = raw.match(CSI_KEY_RE);
  if (csiMatch) {
    const params = splitParams(csiMatch[1]);
    const final = csiMatch[2];
    const keyName = CSI_KEY_MAP[final] ?? (params.length > 0 ? CSI_KEY_MAP[params[0]] : undefined);
    if (keyName) {
      return key(keyName, { ...decodeOptionalModifier(params[1]), raw, source: 'xterm' });
    }
  }

  const ss3Match = raw.match(SS3_RE);
  if (ss3Match) {
    return key(SS3_KEY_MAP[ss3Match[1]] ?? ss3Match[1], { raw, source: 'legacy' });
  }

  if (isControlSequence(raw)) {
    return { type: 'terminalResponse', raw, sequence: classifySequence(raw) };
  }

  const altMatch = raw.match(ALT_PREFIX_RE);
  if (altMatch) {
    const inner = parseInput(altMatch[1]);
    if (inner?.type === 'key') {
      return { ...inner, alt: true, meta: true, raw };
    }
    if (inner?.type === 'text') {
      return key(inner.text, { raw, source: 'legacy', alt: true, meta: true, text: inner.text });
    }
  }

  const chars = Array.from(raw);
  if (chars.length === 1) {
    return key(chars[0], { raw, source: 'legacy', text: chars[0] });
  }

  if (!raw.includes('\x1b')) {
    return { type: 'text', text: raw, raw };
  }

  return { type: 'terminalResponse', raw, sequence: classifySequence(raw) };
}

interface KeyOptions extends Partial<Modifiers> {
  raw: string;
  source: KeyInputEvent['source'];
  kind?: KeyInputEvent['kind'];
  text?: string;
}

function key(name: string, opts: KeyOptions): KeyInputEvent {
  return {
    type: 'key',
    key: name,
    kind: opts.kind ?? 'press',
    shift: opts.shift ?? false,
    ctrl: opts.ctrl ?? false,
    alt: opts.alt ?? false,
    meta: opts.meta ?? false,
    source: opts.source,
    raw: opts.raw,
    ...(opts.text ? { text: opts.text } : {}),
  };
}

function parseSgrMouse(raw: string, match: RegExpMatchArray): MouseInputEvent {
  const cb = Number.parseInt(match[1], 10);
  const x = Number.parseInt(match[2], 10) - 1;
  const y = Number.parseInt(match[3], 10) - 1;
  const final = match[4];
  const modifiers = decodeMouseModifiers(cb);
  const code = cb & ~(4 | 8 | 16);
  const isRelease = final === 'm' || (code & 3) === 3;
  const isWheel = code >= 64 && code <= 67;
  const buttonCode = code & 3;
  const isMove = (code & 32) !== 0 && buttonCode === 3;
  const isDrag = (code & 32) !== 0 && buttonCode < 3;

  return {
    type: 'mouse',
    kind: isWheel ? 'wheel' : isDrag ? 'drag' : isMove ? 'move' : isRelease ? 'release' : 'press',
    button: mouseButton(code, buttonCode),
    x,
    y,
    coordinateSpace: 'cells',
    source: 'sgr',
    raw,
    ...modifiers,
  };
}

function mouseButton(code: number, buttonCode: number): MouseInputEvent['button'] {
  if (code === 64) return 'wheelUp';
  if (code === 65) return 'wheelDown';
  if (code === 66) return 'wheelLeft';
  if (code === 67) return 'wheelRight';
  if (buttonCode === 0) return 'left';
  if (buttonCode === 1) return 'middle';
  if (buttonCode === 2) return 'right';
  return 'unknown';
}

function decodeMouseModifiers(cb: number): Modifiers {
  return {
    shift: (cb & 4) !== 0,
    alt: (cb & 8) !== 0,
    meta: (cb & 8) !== 0,
    ctrl: (cb & 16) !== 0,
  };
}

function decodeEncodedModifiers(encoded: number): Modifiers {
  const mask = Math.max(0, encoded - 1);
  return {
    shift: (mask & 1) !== 0,
    alt: (mask & 2) !== 0,
    ctrl: (mask & 4) !== 0,
    meta: (mask & 8) !== 0 || (mask & 32) !== 0,
  };
}

function decodeOptionalModifier(param?: string): Modifiers {
  if (!param) return { ...NO_MODIFIERS };
  return decodeEncodedModifiers(Number.parseInt(param, 10));
}

function splitParams(params: string): string[] {
  return params.length === 0 ? [] : params.split(';').filter(Boolean);
}

function codepointToKey(code: number): string {
  const named: Record<number, string> = {
    1: 'escape',
    2: 'insert',
    3: 'delete',
    4: 'end',
    5: 'pageUp',
    6: 'pageDown',
    7: 'home',
    8: 'end',
    9: 'tab',
    13: 'enter',
    27: 'escape',
    127: 'backspace',
  };
  return named[code] ?? codepointToText(code) ?? `unknown:${code}`;
}

function codepointToText(code: number): string | undefined {
  if (code < 0x20 || code === 0x7f) return undefined;
  try {
    return String.fromCodePoint(code);
  } catch {
    return undefined;
  }
}

function decodeKittyEventType(modifierAndType: string | undefined): KeyInputEvent['kind'] {
  const eventType = modifierAndType?.split(':')[1];
  if (eventType === '2') return 'repeat';
  if (eventType === '3') return 'release';
  return 'press';
}

function classifySequence(raw: string): 'csi' | 'osc' | 'dcs' | 'apc' | 'pm' | 'sos' | 'escape' | 'unknown' {
  if (raw.startsWith('\x1b[')) return 'csi';
  if (raw.startsWith('\x1b]')) return 'osc';
  if (raw.startsWith('\x1bP')) return 'dcs';
  if (raw.startsWith('\x1b_')) return 'apc';
  if (raw.startsWith('\x1b^')) return 'pm';
  if (raw.startsWith('\x1bX')) return 'sos';
  if (raw.startsWith('\x1b')) return 'escape';
  return 'unknown';
}

function isControlSequence(raw: string): boolean {
  return (
    raw.startsWith('\x1b[') ||
    raw.startsWith('\x1b]') ||
    raw.startsWith('\x1bP') ||
    raw.startsWith('\x1b_') ||
    raw.startsWith('\x1b^') ||
    raw.startsWith('\x1bX')
  );
}

/**
 * Query the terminal for Kitty keyboard protocol support.
 * Sends `\x1b[?u` and waits for `\x1b[?Nu` response.
 */
export async function probeKittyKeyboard(timeoutMs = 50): Promise<boolean> {
  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let buf = '';

    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      process.stdin.removeListener('data', onData);
      if (!wasRaw) process.stdin.setRawMode(false);
      resolve(result);
    };

    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      // deno-lint-ignore no-control-regex
      const match = buf.match(/\x1b\[\?(\d+)u/);
      if (match) {
        finish(Number.parseInt(match[1], 10) > 0);
      }
    };

    timer = setTimeout(() => finish(false), timeoutMs);
    process.stdin.on('data', onData);
    process.stdout.write('\x1b[?u');
  });
}
