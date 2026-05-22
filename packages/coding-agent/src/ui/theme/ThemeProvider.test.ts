import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from './ThemeProvider';
import { darkTheme } from './themes/dark';
import { lightTheme } from './themes/light';

describe('ThemeProvider', () => {
  it('returns the initial theme via current()', () => {
    const provider = new ThemeProvider(darkTheme);
    expect(provider.current()).toBe(darkTheme);
  });

  it('notifies subscribers when the theme changes', () => {
    const provider = new ThemeProvider(darkTheme);
    const subscriber = vi.fn();
    provider.subscribe(subscriber);

    provider.setTheme(lightTheme);

    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledWith(lightTheme);
    expect(provider.current()).toBe(lightTheme);
  });

  it('does not notify when the theme is unchanged', () => {
    const provider = new ThemeProvider(darkTheme);
    const subscriber = vi.fn();
    provider.subscribe(subscriber);

    provider.setTheme(darkTheme);

    expect(subscriber).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe()', () => {
    const provider = new ThemeProvider(darkTheme);
    const subscriber = vi.fn();
    const unsubscribe = provider.subscribe(subscriber);

    unsubscribe();
    provider.setTheme(lightTheme);

    expect(subscriber).not.toHaveBeenCalled();
  });

  it('isolates subscriber errors', () => {
    const provider = new ThemeProvider(darkTheme);
    const noisy = vi.fn(() => {
      throw new Error('boom');
    });
    const quiet = vi.fn();
    provider.subscribe(noisy);
    provider.subscribe(quiet);

    expect(() => provider.setTheme(lightTheme)).not.toThrow();
    expect(quiet).toHaveBeenCalledTimes(1);
  });
});
