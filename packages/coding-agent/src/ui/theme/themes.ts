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
    950: '#0b0b0e' as Color,
  },
  blue: { 300: '#93c5fd' as Color, 400: '#60a5fa' as Color, 600: '#2563eb' as Color },
  red: { 400: '#f87171' as Color, 600: '#dc2626' as Color },
  green: { 400: '#4ade80' as Color, 600: '#16a34a' as Color },
  yellow: { 400: '#facc15' as Color, 500: '#eab308' as Color },
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
  },
  styles: {
    body: { fg: palette.neutral[100] },
    muted: { fg: palette.neutral[400], dim: true },
    title: { fg: palette.neutral[0], bold: true },
    userMessage: { fg: palette.neutral[100] },
    assistantMessage: { fg: palette.neutral[100] },
    reasoning: { fg: palette.neutral[400], italic: true },
    commandPaletteItem: { fg: palette.neutral[100], bg: palette.neutral[900] },
    commandPaletteHover: { fg: palette.neutral[100], bg: palette.neutral[800] },
    commandPaletteSelected: { fg: palette.neutral[0], bg: palette.neutral[700] },
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
    commandPaletteSelected: { fg: palette.neutral[950], bg: palette.neutral[200] },
    errorLine: { fg: palette.neutral[900] },
    errorPrefix: { fg: palette.red[600], bold: true },
  },
};
