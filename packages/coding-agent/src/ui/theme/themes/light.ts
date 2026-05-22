import { palette } from '../palette';
import type { Theme } from '../tokens';

export const lightTheme: Theme = {
  name: 'light',
  palette,
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
