import { createContext, type ReactNode, useContext } from 'react';
import { DEFAULT_THEME } from '../theme/presets';
import type { Theme } from '../theme/types';

/**
 * Theme is read in many small components, so a dedicated context keeps
 * `ChatContext` focused on session/runtime state and avoids re-renders
 * cascading through unrelated subtrees when chat state changes.
 */
const ThemeContext = createContext<Theme>(DEFAULT_THEME);

export function ThemeProvider({ theme, children }: { theme: Theme; children: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
