import type { Color } from 'mu-tui';
import type { Palette } from './palette';

/**
 * A structured text style. Consumers pass these to `styleToAnsi` /
 * `wrapWithStyle` to obtain SGR escape strings.
 */
export interface TextStyle {
  fg?: Color;
  bg?: Color;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/** Semantic color tokens. Map roles to palette values. */
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

/** Component / role text styles. */
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
  palette: Palette;
  colors: ThemeColors;
  styles: ThemeStyles;
}
