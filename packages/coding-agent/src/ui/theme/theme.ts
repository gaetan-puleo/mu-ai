import type { Color, EventContext, RenderContext } from 'mu-tui';
import { darkTheme, type TextStyle, type Theme } from './themes';

// --- ANSI encoding ---

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

export function fgToAnsi(color: Color): string {
  if (color.startsWith('#')) {
    const rgb = hexToRgb(color);
    return rgb ? `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m` : '';
  }
  return NAMED_FG[color] ?? '';
}

export function bgToAnsi(color: Color): string {
  if (color.startsWith('#')) {
    const rgb = hexToRgb(color);
    return rgb ? `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m` : '';
  }
  return NAMED_BG[color] ?? '';
}

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

export function wrapWithStyle(text: string, style: TextStyle): string {
  const prefix = styleToAnsi(style);
  if (!prefix) return text;
  return `${prefix}${text}\x1b[0m`;
}

// --- ThemeProvider ---

export type ThemeSubscriber = (theme: Theme) => void;

export class ThemeProvider {
  private theme: Theme;
  private readonly subscribers: Set<ThemeSubscriber> = new Set();

  constructor(initial: Theme) {
    this.theme = initial;
  }

  current(): Theme {
    return this.theme;
  }

  setTheme(next: Theme): void {
    if (this.theme === next) return;
    this.theme = next;
    for (const subscriber of this.subscribers) {
      try {
        subscriber(next);
      } catch {
        /* subscriber errors must not break the provider */
      }
    }
  }

  subscribe(fn: ThemeSubscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }
}

// --- getTheme ---

export function getTheme(ctx: RenderContext | EventContext): Theme {
  const value = ctx.userContext;
  if (value instanceof ThemeProvider) return value.current();
  if (typeof value === 'object' && value !== null && 'colors' in value && 'styles' in value && 'name' in value) {
    return value as Theme;
  }
  return darkTheme;
}
