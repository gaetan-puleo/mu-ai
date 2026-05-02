import { describe, expect, it } from 'bun:test';
import { mergeTheme, resolveTheme } from './merge';
import { DEFAULT_THEME } from './presets';

describe('mergeTheme', () => {
  it('returns the base theme untouched when no override is provided', () => {
    expect(mergeTheme(DEFAULT_THEME)).toBe(DEFAULT_THEME);
  });

  it('merges leaf overrides without dropping siblings', () => {
    const merged = mergeTheme(DEFAULT_THEME, { input: { cursor: '#ff00ff' } });
    expect(merged.input.cursor).toBe('#ff00ff');
    expect(merged.input.background).toBe(DEFAULT_THEME.input.background);
    expect(merged.user).toEqual(DEFAULT_THEME.user);
  });

  it('does not mutate the base theme', () => {
    const before = DEFAULT_THEME.input.cursor;
    mergeTheme(DEFAULT_THEME, { input: { cursor: '#000000' } });
    expect(DEFAULT_THEME.input.cursor).toBe(before);
  });

  it('ignores non-object sections defensively', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing malformed user input on purpose
    const merged = mergeTheme(DEFAULT_THEME, { input: 'red' as any });
    expect(merged.input).toEqual(DEFAULT_THEME.input);
  });
});

describe('resolveTheme', () => {
  it('returns the default theme when config is undefined', () => {
    expect(resolveTheme(undefined)).toBe(DEFAULT_THEME);
  });

  it('applies overrides on top of the default theme', () => {
    const theme = resolveTheme({ user: { border: 'magenta' } });
    expect(theme.user.border).toBe('magenta');
    expect(theme.input).toEqual(DEFAULT_THEME.input);
  });

  it('returns default for non-object input', () => {
    // biome-ignore lint/suspicious/noExplicitAny: malformed value
    expect(resolveTheme(42 as any)).toBe(DEFAULT_THEME);
    // biome-ignore lint/suspicious/noExplicitAny: malformed value
    expect(resolveTheme(null as any)).toBe(DEFAULT_THEME);
    // biome-ignore lint/suspicious/noExplicitAny: string presets are no longer supported
    expect(resolveTheme('dark' as any)).toBe(DEFAULT_THEME);
  });
});
