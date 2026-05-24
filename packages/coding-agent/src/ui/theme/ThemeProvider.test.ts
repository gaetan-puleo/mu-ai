import { expect, fn } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { ThemeProvider, type ThemeSubscriber } from './theme';
import { darkTheme, lightTheme } from './themes';

describe('ThemeProvider', () => {
  it('returns the initial theme via current()', () => {
    const provider = new ThemeProvider(darkTheme);
    expect(provider.current()).toBe(darkTheme);
  });

  it('notifies subscribers when the theme changes', () => {
    const provider = new ThemeProvider(darkTheme);
    const subscriber = fn() as ThemeSubscriber;
    provider.subscribe(subscriber);

    provider.setTheme(lightTheme);

    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledWith(lightTheme);
    expect(provider.current()).toBe(lightTheme);
  });

  it('does not notify when the theme is unchanged', () => {
    const provider = new ThemeProvider(darkTheme);
    const subscriber = fn() as ThemeSubscriber;
    provider.subscribe(subscriber);

    provider.setTheme(darkTheme);

    expect(subscriber).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe()', () => {
    const provider = new ThemeProvider(darkTheme);
    const subscriber = fn() as ThemeSubscriber;
    const unsubscribe = provider.subscribe(subscriber);

    unsubscribe();
    provider.setTheme(lightTheme);

    expect(subscriber).not.toHaveBeenCalled();
  });

  it('isolates subscriber errors', () => {
    const provider = new ThemeProvider(darkTheme);
    const noisy = fn(() => {
      throw new Error('boom');
    }) as ThemeSubscriber;
    const quiet = fn() as ThemeSubscriber;
    provider.subscribe(noisy);
    provider.subscribe(quiet);

    expect(() => provider.setTheme(lightTheme)).not.toThrow();
    expect(quiet).toHaveBeenCalledTimes(1);
  });
});
