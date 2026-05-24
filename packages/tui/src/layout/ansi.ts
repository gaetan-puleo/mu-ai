import { charWidth } from '../utils';
import { type Cell, type CellStyle, continuationCell, defaultStyle, styleEqual } from './cell';
import { DEFAULT_BG, DEFAULT_FG, indexedColor, palette256, rgbaToSgr, type Rgba, rgbColor } from './color';

/**
 * Parse an ANSI-styled string into a row of `Cell`s.
 *
 * The parser is a small state machine over bytes:
 *
 *   - `0x1b [ ... m`            — SGR; updates current style
 *   - `0x1b ] 8 ; ; url ST/BEL` — OSC 8 hyperlink open
 *   - `0x1b ] 8 ; ; ST/BEL`     — OSC 8 hyperlink close
 *   - other CSI / OSC / DCS     — consumed and ignored
 *   - printable text            — emitted as cells using current style
 *
 * Wide characters produce a width-2 primary cell followed by a width-0
 * continuation cell, mirroring `utils.charWidth`.
 */
export function parseLine(line: string): Cell[] {
  const cells: Cell[] = [];
  let style = defaultStyle();
  let i = 0;
  const n = line.length;

  while (i < n) {
    const code = line.codePointAt(i);
    if (code === undefined) {
      i++;
      continue;
    }

    if (code === 0x1b) {
      i = consumeEscape(line, i + 1, (newStyle) => {
        style = newStyle;
      }, style);
      continue;
    }

    const w = charWidth(code) as 0 | 1 | 2;
    const step = code > 0xffff ? 2 : 1;
    const grapheme = line.slice(i, i + step);
    i += step;

    if (w === 0) {
      // Control char or zero-width: skip silently.
      continue;
    }

    cells.push({ grapheme, width: w, style: cloneStyle(style) });
    if (w === 2) cells.push(continuationCell());
  }

  return cells;
}

/**
 * Serialize a row of `Cell`s to an ANSI-styled string with minimal SGR deltas.
 *
 * - Coalesces runs of identical style into a single transition.
 * - Skips continuation cells (`width === 0`).
 * - Emits an explicit reset at the end so the row is self-contained.
 */
export function cellsToAnsi(cells: Cell[]): string {
  let out = '';
  let prev: CellStyle | null = null;
  let prevLink: string | undefined;
  let needsReset = false;

  for (const cell of cells) {
    if (cell.width === 0) continue;

    if (!prev || !styleEqual(prev, cell.style)) {
      const delta = sgrDelta(prev, cell.style);
      if (delta.length > 0) {
        out += delta;
        needsReset = true;
      }
      prev = cell.style;
    }
    if (cell.style.link !== prevLink) {
      out += linkEscape(cell.style.link);
      prevLink = cell.style.link;
      if (cell.style.link) needsReset = true;
    }
    out += cell.grapheme || ' ';
  }

  if (needsReset) out += '\x1b[0m';
  if (prevLink) out += '\x1b]8;;\x07';
  return out;
}

function consumeEscape(
  input: string,
  index: number,
  setStyle: (style: CellStyle) => void,
  currentStyle: CellStyle,
): number {
  if (index >= input.length) return index;
  const next = input.charCodeAt(index);

  // CSI: ESC [ params intermediates final
  if (next === 0x5b /* '[' */) {
    let j = index + 1;
    while (j < input.length) {
      const c = input.charCodeAt(j);
      if (c >= 0x40 && c <= 0x7e) {
        const params = input.slice(index + 1, j);
        if (c === 0x6d /* 'm' */) {
          setStyle(applySgr(currentStyle, params));
        }
        return j + 1;
      }
      j++;
    }
    return input.length;
  }

  // OSC: ESC ] payload (BEL | ESC \)
  if (next === 0x5d /* ']' */) {
    let j = index + 1;
    while (j < input.length) {
      const c = input.charCodeAt(j);
      if (c === 0x07) {
        const payload = input.slice(index + 1, j);
        applyOsc(payload, setStyle, currentStyle);
        return j + 1;
      }
      if (c === 0x1b && j + 1 < input.length && input.charCodeAt(j + 1) === 0x5c /* '\' */) {
        const payload = input.slice(index + 1, j);
        applyOsc(payload, setStyle, currentStyle);
        return j + 2;
      }
      j++;
    }
    return input.length;
  }

  // DCS / APC / PM / SOS: ESC X ... ST  — consume until ST.
  if (next === 0x50 || next === 0x5e || next === 0x5f || next === 0x58) {
    let j = index + 1;
    while (j < input.length - 1) {
      if (input.charCodeAt(j) === 0x1b && input.charCodeAt(j + 1) === 0x5c) {
        return j + 2;
      }
      j++;
    }
    return input.length;
  }

  // Any other ESC sequence: skip the following byte.
  return index + 1;
}

function applyOsc(payload: string, setStyle: (style: CellStyle) => void, current: CellStyle): void {
  // OSC 8 ; params ; url   (hyperlink)
  if (payload.startsWith('8;')) {
    const semi = payload.indexOf(';', 2);
    const url = semi === -1 ? '' : payload.slice(semi + 1);
    const next: CellStyle = { ...current, link: url.length > 0 ? url : undefined };
    setStyle(next);
  }
}

function applySgr(current: CellStyle, params: string): CellStyle {
  const next: CellStyle = cloneStyle(current);
  // Empty SGR (e.g. "\x1b[m") is equivalent to reset.
  if (params.length === 0) return resetStyle(next);

  const parts = params.split(';');
  let i = 0;
  while (i < parts.length) {
    const n = parts[i] === '' ? 0 : Number.parseInt(parts[i], 10);
    if (Number.isNaN(n)) {
      i++;
      continue;
    }

    switch (n) {
      case 0:
        resetStyle(next);
        break;
      case 1:
        next.bold = true;
        break;
      case 2:
        next.dim = true;
        break;
      case 3:
        next.italic = true;
        break;
      case 4:
        next.underline = true;
        break;
      case 5:
      case 6:
        next.blink = true;
        break;
      case 7:
        next.reverse = true;
        break;
      case 9:
        next.strikethrough = true;
        break;
      case 22:
        next.bold = false;
        next.dim = false;
        break;
      case 23:
        next.italic = false;
        break;
      case 24:
        next.underline = false;
        break;
      case 25:
        next.blink = false;
        break;
      case 27:
        next.reverse = false;
        break;
      case 29:
        next.strikethrough = false;
        break;
      case 38: {
        const consumed = parseExtendedColor(parts, i + 1, (rgba) => {
          next.fg = rgba;
        });
        i += consumed;
        break;
      }
      case 48: {
        const consumed = parseExtendedColor(parts, i + 1, (rgba) => {
          next.bg = rgba;
        });
        i += consumed;
        break;
      }
      case 39:
        next.fg = { ...DEFAULT_FG };
        break;
      case 49:
        next.bg = { ...DEFAULT_BG };
        break;
      default:
        if (n >= 30 && n <= 37) next.fg = indexed(n - 30);
        else if (n >= 40 && n <= 47) next.bg = indexed(n - 40);
        else if (n >= 90 && n <= 97) next.fg = indexed(n - 90 + 8);
        else if (n >= 100 && n <= 107) next.bg = indexed(n - 100 + 8);
        break;
    }
    i++;
  }

  return next;
}

/** Consume an extended color spec following `38` or `48`. Returns count consumed. */
function parseExtendedColor(parts: string[], from: number, set: (rgba: Rgba) => void): number {
  const mode = parts[from] === undefined ? -1 : Number.parseInt(parts[from], 10);
  if (mode === 5) {
    const idx = Number.parseInt(parts[from + 1] ?? '0', 10);
    set(indexedColor(Number.isNaN(idx) ? 0 : idx));
    return 2;
  }
  if (mode === 2) {
    const r = Number.parseInt(parts[from + 1] ?? '0', 10);
    const g = Number.parseInt(parts[from + 2] ?? '0', 10);
    const b = Number.parseInt(parts[from + 3] ?? '0', 10);
    set(rgbColor(clamp255(r), clamp255(g), clamp255(b)));
    return 4;
  }
  return 0;
}

function indexed(index: number): Rgba {
  const [r, g, b] = palette256(index);
  return { r, g, b, a: 1, intent: 'indexed', index };
}

function clamp255(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(255, n));
}

function resetStyle(style: CellStyle): CellStyle {
  style.fg = { ...DEFAULT_FG };
  style.bg = { ...DEFAULT_BG };
  style.bold = false;
  style.dim = false;
  style.italic = false;
  style.underline = false;
  style.strikethrough = false;
  style.reverse = false;
  style.blink = false;
  style.link = undefined;
  return style;
}

function cloneStyle(style: CellStyle): CellStyle {
  return {
    fg: { ...style.fg },
    bg: { ...style.bg },
    bold: style.bold,
    dim: style.dim,
    italic: style.italic,
    underline: style.underline,
    strikethrough: style.strikethrough,
    reverse: style.reverse,
    blink: style.blink,
    link: style.link,
  };
}

function sgrDelta(prev: CellStyle | null, next: CellStyle): string {
  const params: string[] = [];

  if (!prev) {
    // First cell: emit only non-default attributes.
    if (next.bold) params.push('1');
    if (next.dim) params.push('2');
    if (next.italic) params.push('3');
    if (next.underline) params.push('4');
    if (next.blink) params.push('5');
    if (next.reverse) params.push('7');
    if (next.strikethrough) params.push('9');
    if (next.fg.intent !== 'default') params.push(rgbaToSgr(next.fg, 'fg'));
    if (next.bg.intent !== 'default' && next.bg.a > 0) params.push(rgbaToSgr(next.bg, 'bg'));
    if (params.length === 0) return '';
    return `\x1b[${params.join(';')}m`;
  }

  if (prev.bold !== next.bold || prev.dim !== next.dim) {
    if (!next.bold && !next.dim && (prev.bold || prev.dim)) params.push('22');
    if (next.bold && !prev.bold) params.push('1');
    if (next.dim && !prev.dim) params.push('2');
  }
  if (prev.italic !== next.italic) params.push(next.italic ? '3' : '23');
  if (prev.underline !== next.underline) params.push(next.underline ? '4' : '24');
  if (prev.blink !== next.blink) params.push(next.blink ? '5' : '25');
  if (prev.reverse !== next.reverse) params.push(next.reverse ? '7' : '27');
  if (prev.strikethrough !== next.strikethrough) params.push(next.strikethrough ? '9' : '29');

  if (!rgbaShallowEqual(prev.fg, next.fg)) params.push(rgbaToSgr(next.fg, 'fg'));
  if (!rgbaShallowEqual(prev.bg, next.bg)) params.push(rgbaToSgr(next.bg, 'bg'));

  if (params.length === 0) return '';
  return `\x1b[${params.join(';')}m`;
}

function rgbaShallowEqual(a: Rgba, b: Rgba): boolean {
  return (
    a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a && a.intent === b.intent && a.index === b.index
  );
}

function linkEscape(link: string | undefined): string {
  if (!link) return '\x1b]8;;\x07';
  return `\x1b]8;;${link}\x07`;
}
