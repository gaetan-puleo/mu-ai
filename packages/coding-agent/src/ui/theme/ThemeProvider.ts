import type { Theme } from './tokens';

export type ThemeSubscriber = (theme: Theme) => void;

/**
 * Holds the current theme and notifies subscribers when it changes.
 *
 * The provider is passed into the TUI as `userContext` — the TUI core treats
 * the provider as opaque data, and components read it via `getTheme(ctx)`.
 *
 * On `setTheme`, the wiring layer (typically `ChatApp` / `main.ts`) should
 * call `tui.setUserContext(provider)` (or equivalent) to trigger a full
 * redraw with the new tokens. The provider itself stays mutable so live
 * subscribers also receive the update.
 */
export class ThemeProvider {
  private theme: Theme;
  private readonly subscribers: Set<ThemeSubscriber> = new Set();

  constructor(initial: Theme) {
    this.theme = initial;
  }

  current(): Theme {
    return this.theme;
  }

  setTheme(next: Theme): void {
    if (this.theme === next) return;
    this.theme = next;
    for (const subscriber of this.subscribers) {
      try {
        subscriber(next);
      } catch {
        /* subscriber errors must not break the provider */
      }
    }
  }

  subscribe(fn: ThemeSubscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }
}
