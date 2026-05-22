import type { Color } from 'mu-tui';

/**
 * Raw color palette. Values are `#rrggbb` strings typed as `mu-tui` `Color`s so
 * they can be assigned directly to `LayoutStyle.backgroundColor` or used by
 * `styleToAnsi`.
 *
 * Themes pick semantic colors from this palette (see `tokens.ts` /
 * `themes/dark.ts`). Avoid using palette values directly outside the theme
 * module — prefer semantic tokens like `theme.colors.surface`.
 */
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
  blue: {
    300: '#93c5fd' as Color,
    400: '#60a5fa' as Color,
    500: '#3b82f6' as Color,
    600: '#2563eb' as Color,
  },
  red: {
    400: '#f87171' as Color,
    500: '#ef4444' as Color,
    600: '#dc2626' as Color,
  },
  green: {
    400: '#4ade80' as Color,
    500: '#22c55e' as Color,
    600: '#16a34a' as Color,
  },
  yellow: {
    400: '#facc15' as Color,
    500: '#eab308' as Color,
  },
} as const;

export type Palette = typeof palette;
