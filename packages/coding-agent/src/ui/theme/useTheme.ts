import type { EventContext, RenderContext } from 'mu-tui';
import { ThemeProvider } from './ThemeProvider';
import { darkTheme } from './themes/dark';
import type { Theme } from './tokens';

/**
 * Read the active `Theme` from a `RenderContext` or `EventContext`.
 *
 * Accepts either a raw `Theme` object or a `ThemeProvider` stored as
 * `userContext`. Falls back to `darkTheme` when nothing was wired — this keeps
 * isolated unit tests rendering without forcing every test to spin up a
 * provider.
 */
export function getTheme(ctx: RenderContext | EventContext): Theme {
  const value = ctx.userContext;
  if (value instanceof ThemeProvider) {
    return value.current();
  }
  if (isTheme(value)) {
    return value;
  }
  return darkTheme;
}

function isTheme(value: unknown): value is Theme {
  return typeof value === 'object' && value !== null && 'colors' in value && 'styles' in value && 'name' in value;
}
