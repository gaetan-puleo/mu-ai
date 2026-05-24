import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { createDefaultCapabilities, type RenderContext } from 'mu-tui';
import { ThemeProvider } from './ThemeProvider';
import { darkTheme } from './themes/dark';
import { lightTheme } from './themes/light';
import { getTheme } from './useTheme';

function makeCtx(userContext: unknown): RenderContext {
  return {
    rect: { x: 0, y: 0, width: 10, height: 1 },
    contentRect: { x: 0, y: 0, width: 10, height: 1 },
    focused: false,
    capabilities: createDefaultCapabilities({}),
    userContext,
  };
}

describe('getTheme', () => {
  it('unwraps a ThemeProvider', () => {
    const provider = new ThemeProvider(lightTheme);
    expect(getTheme(makeCtx(provider))).toBe(lightTheme);
  });

  it('accepts a raw Theme', () => {
    expect(getTheme(makeCtx(darkTheme))).toBe(darkTheme);
  });

  it('falls back to darkTheme when userContext is missing', () => {
    expect(getTheme(makeCtx(undefined))).toBe(darkTheme);
  });

  it('reflects setTheme on the same provider', () => {
    const provider = new ThemeProvider(darkTheme);
    const ctx = makeCtx(provider);
    expect(getTheme(ctx)).toBe(darkTheme);
    provider.setTheme(lightTheme);
    expect(getTheme(ctx)).toBe(lightTheme);
  });
});
