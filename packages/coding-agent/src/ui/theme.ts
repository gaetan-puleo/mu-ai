import type { Color } from 'mu-tui';

export interface TextStyle {
  fg?: Color;
  bg?: Color;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface ThemeColors {
  background: Color;
  surface: Color;
  surfaceMuted: Color;
  border: Color;
  text: Color;
  textMuted: Color;
  accent: Color;
  success: Color;
  warning: Color;
  danger: Color;
  syntaxKeyword: Color;
  syntaxString: Color;
  syntaxFunction: Color;
  syntaxNumber: Color;
  syntaxComment: Color;
}

export interface ThemeStyles {
  body: TextStyle;
  muted: TextStyle;
  title: TextStyle;
  userMessage: TextStyle;
  assistantMessage: TextStyle;
  reasoning: TextStyle;
  commandPaletteItem: TextStyle;
  commandPaletteHover: TextStyle;
  commandPaletteSelected: TextStyle;
  bashPrompt: TextStyle;
  errorLine: TextStyle;
  errorPrefix: TextStyle;
}

export interface Theme {
  name: string;
  colors: ThemeColors;
  styles: ThemeStyles;
}

export const palette = {
  neutral: {
    0: '#ffffff' as Color,
    50: '#fafafa' as Color,
    100: '#f4f4f5' as Color,
    200: '#e4e4e7' as Color,
    300: '#d4d4d8' as Color,
    400: '#a1a1aa' as Color,
    500: '#71717a' as Color,
    600: '#52525b' as Color,
    700: '#3f3f46' as Color,
    800: '#27272a' as Color,
    900: '#18181b' as Color,
    925: '#111114' as Color,
    950: '#0b0b0e' as Color,
  },
  blue: { 300: '#93c5fd' as Color, 400: '#60a5fa' as Color, 600: '#2563eb' as Color },
  red: { 400: '#f87171' as Color, 600: '#dc2626' as Color },
  green: { 400: '#4ade80' as Color, 600: '#16a34a' as Color, 800: '#2d6a3f' as Color },
  yellow: { 300: '#f0ae5d' as Color, 400: '#e89b24' as Color, 500: '#c87f12' as Color },
} as const;

export const darkTheme: Theme = {
  name: 'dark',
  colors: {
    background: palette.neutral[950],
    surface: palette.neutral[900],
    surfaceMuted: palette.neutral[800],
    border: palette.neutral[700],
    text: palette.neutral[100],
    textMuted: palette.neutral[400],
    accent: palette.blue[400],
    success: palette.green[400],
    warning: palette.yellow[400],
    danger: palette.red[400],
    syntaxKeyword: '#cba6f7' as Color,
    syntaxString: '#a6e3a1' as Color,
    syntaxFunction: '#89b4fa' as Color,
    syntaxNumber: '#fab387' as Color,
    syntaxComment: '#6c7086' as Color,
  },
  styles: {
    body: { fg: palette.neutral[100] },
    muted: { fg: palette.neutral[400], dim: true },
    title: { fg: palette.neutral[0], bold: true },
    userMessage: { fg: palette.neutral[100], bg: palette.neutral[925] },
    assistantMessage: { fg: palette.neutral[100] },
    reasoning: { fg: palette.neutral[400], italic: true },
    commandPaletteItem: { fg: palette.neutral[100], bg: palette.neutral[900] },
    commandPaletteHover: { fg: palette.neutral[100], bg: palette.neutral[800] },
    commandPaletteSelected: { fg: palette.neutral[950], bg: palette.yellow[300], bold: true },
    bashPrompt: { fg: palette.neutral[0] },
    errorLine: { fg: palette.neutral[100] },
    errorPrefix: { fg: palette.red[400], bold: true },
  },
};

export const lightTheme: Theme = {
  name: 'light',
  colors: {
    background: palette.neutral[0],
    surface: palette.neutral[50],
    surfaceMuted: palette.neutral[100],
    border: palette.neutral[300],
    text: palette.neutral[900],
    textMuted: palette.neutral[600],
    accent: palette.blue[600],
    success: palette.green[600],
    warning: palette.yellow[500],
    danger: palette.red[600],
    syntaxKeyword: '#8839ef' as Color,
    syntaxString: '#40a02b' as Color,
    syntaxFunction: '#1e66f5' as Color,
    syntaxNumber: '#fe640b' as Color,
    syntaxComment: '#9ca0b0' as Color,
  },
  styles: {
    body: { fg: palette.neutral[900] },
    muted: { fg: palette.neutral[500] },
    title: { fg: palette.neutral[950], bold: true },
    userMessage: { fg: palette.neutral[900] },
    assistantMessage: { fg: palette.neutral[900] },
    reasoning: { fg: palette.neutral[600], italic: true },
    commandPaletteItem: { fg: palette.neutral[900], bg: palette.neutral[50] },
    commandPaletteHover: { fg: palette.neutral[900], bg: palette.neutral[100] },
    commandPaletteSelected: { fg: palette.neutral[950], bg: palette.yellow[300], bold: true },
    bashPrompt: { fg: palette.neutral[950] },
    errorLine: { fg: palette.neutral[900] },
    errorPrefix: { fg: palette.red[600], bold: true },
  },
};

export const themesByName: Record<string, Theme> = { dark: darkTheme, light: lightTheme };

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
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
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

export function asHexColor(value: string | undefined): `#${string}` | undefined {
  if (value && value.startsWith('#')) return value as `#${string}`;
  return undefined;
}

export type ThemeSubscriber = (theme: Theme) => void;

export class ThemeProvider {
  private theme: Theme;
  private readonly subscribers = new Set<ThemeSubscriber>();

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
        // a faulty subscriber must not break theme switching
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
