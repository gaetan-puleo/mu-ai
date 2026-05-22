import type { Color } from 'mu-tui';
import type { TextStyle } from './tokens';

const RESET = '\x1b[0m';

const NAMED_FG: Record<string, string> = {
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
};

const NAMED_BG: Record<string, string> = {
  black: '\x1b[40m',
  red: '\x1b[41m',
  green: '\x1b[42m',
  yellow: '\x1b[43m',
  blue: '\x1b[44m',
  magenta: '\x1b[45m',
  cyan: '\x1b[46m',
  white: '\x1b[47m',
  brightBlack: '\x1b[100m',
  brightRed: '\x1b[101m',
  brightGreen: '\x1b[102m',
  brightYellow: '\x1b[103m',
  brightBlue: '\x1b[104m',
  brightMagenta: '\x1b[105m',
  brightCyan: '\x1b[106m',
  brightWhite: '\x1b[107m',
};

function hexToRgb(hex: string): [number, number, number] | undefined {
  let h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (h.length !== 6) return undefined;
  const value = Number.parseInt(h, 16);
  if (!Number.isFinite(value)) return undefined;
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Convert a `Color` to an SGR foreground escape. Returns '' on failure. */
export function fgToAnsi(color: Color): string {
  if (color.startsWith('#')) {
    const rgb = hexToRgb(color);
    return rgb ? `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m` : '';
  }
  return NAMED_FG[color] ?? '';
}

/** Convert a `Color` to an SGR background escape. Returns '' on failure. */
export function bgToAnsi(color: Color): string {
  if (color.startsWith('#')) {
    const rgb = hexToRgb(color);
    return rgb ? `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m` : '';
  }
  return NAMED_BG[color] ?? '';
}

/**
 * Build an SGR prefix from a `TextStyle`. The result is a concatenation of
 * style SGRs ready to be prepended to text. Use `wrapWithStyle` to also append
 * a reset.
 */
export function styleToAnsi(style: TextStyle): string {
  let out = '';
  if (style.bold) out += '\x1b[1m';
  if (style.dim) out += '\x1b[2m';
  if (style.italic) out += '\x1b[3m';
  if (style.underline) out += '\x1b[4m';
  if (style.fg) out += fgToAnsi(style.fg);
  if (style.bg) out += bgToAnsi(style.bg);
  return out;
}

/** Wrap text with the SGR prefix from `style` and a trailing reset. */
export function wrapWithStyle(text: string, style: TextStyle): string {
  const prefix = styleToAnsi(style);
  if (!prefix) return text;
  return `${prefix}${text}${RESET}`;
}
