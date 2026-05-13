import { createContext, type ReactNode, useContext } from 'react';
import { defaultTheme } from './defaultTheme';
import type { Theme } from './types';

const ThemeContext = createContext<Theme>(defaultTheme);

export function ThemeProvider({ theme, children }: { theme?: Theme; children: ReactNode }) {
  return <ThemeContext.Provider value={theme ?? defaultTheme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
