import { palette } from '../palette';
import type { Theme } from '../tokens';

export const darkTheme: Theme = {
  name: 'dark',
  palette,
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
