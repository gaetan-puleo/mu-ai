/**
 * TUI keybind registry — host-owned, plugin-facing.
 *
 * Counterpart to `TUI_SLOTS`: where slots let plugins inject UI into well-
 * known locations, keybinds let them attach behaviour to a key chord. The
 * Chat component runs the dispatcher inside its `useInput` handler AFTER
 * built-in reserved branches (Ctrl+C, Esc-while-busy, palette nav). Plugin
 * keybinds therefore never override reserved keys; collisions are silent.
 *
 * Matching is **strict**: unspecified modifier fields in a chord MUST be
 * false on the event. `{shift: true, tab: true}` matches Shift+Tab, but
 * Ctrl+Shift+Tab is rejected. This avoids accidental overlap when plugins
 * pick simple chords.
 *
 * Ordering: handlers are invoked in registration order; the first one whose
 * `run()` returns anything other than `false` consumes the event. Plugins
 * can return `false` to opt out at the last moment (e.g. when their
 * underlying state isn't ready) and let later handlers see the key.
 *
 * The registry exposes `subscribe()` so a future cheat-sheet view can re-
 * render when bindings change. The current dispatcher reads `list()`
 * synchronously per event and does not subscribe.
 */

import type { Key } from 'ink';

/**
 * Subset of Ink's `Key` plus an optional `char` (the `input` argument to
 * `useInput`). Every field defaults to `false` for matching purposes — see
 * `keyMatches` below.
 */
export interface KeyChord {
  /**
   * Literal character to match against the `input` argument of useInput.
   * Leave undefined to match purely on modifier/named-key flags.
   */
  char?: string;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  tab?: boolean;
  escape?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  home?: boolean;
  end?: boolean;
  /** Enter / Return. */
  return?: boolean;
  /** Delete key. */
  delete?: boolean;
  /** Backspace. */
  backspace?: boolean;
}

export interface KeybindHandler {
  chord: KeyChord;
  /** Short label shown in help / cheat-sheet. e.g. "cycle active agent". */
  description: string;
  /**
   * Optional gate. If returns false, the binding is skipped without
   * consuming the event. Use for context-sensitive bindings (e.g. only
   * fire when a session is mounted).
   */
  when?: () => boolean;
  /**
   * Invoked when chord matches. Return `false` to decline the event (let
   * later handlers see it). Anything else (undefined / true / void)
   * consumes the event.
   */
  run: () => boolean | void;
}

/** Names of every modifier / named-key field on KeyChord (NOT `char`). */
const KEY_FIELDS = [
  'shift',
  'ctrl',
  'meta',
  'tab',
  'escape',
  'upArrow',
  'downArrow',
  'leftArrow',
  'rightArrow',
  'pageUp',
  'pageDown',
  'home',
  'end',
  'return',
  'delete',
  'backspace',
] as const satisfies ReadonlyArray<Exclude<keyof KeyChord, 'char'>>;

/**
 * Strict match: every Ink key flag must equal `chord.<field> ?? false`. If
 * `chord.char` is set, `input` must equal it byte-for-byte.
 *
 * Exported for tests.
 */
export function keyMatches(chord: KeyChord, input: string, key: Key): boolean {
  if (chord.char !== undefined && chord.char !== input) return false;
  for (const field of KEY_FIELDS) {
    const want = chord[field] ?? false;
    // Ink's Key type is partial across versions; treat missing as false.
    const got = (key as unknown as Record<string, boolean | undefined>)[field] ?? false;
    if (want !== got) return false;
  }
  return true;
}

class KeybindRegistry {
  private handlers: KeybindHandler[] = [];
  private listeners = new Set<() => void>();

  register(handler: KeybindHandler): () => void {
    this.handlers.push(handler);
    this.bump();
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
      this.bump();
    };
  }

  /**
   * Return the registered handlers in registration order. Returned array
   * is a live reference into the registry; callers must not mutate it. We
   * deliberately skip a defensive copy because the dispatcher is on the
   * hot path of every keystroke.
   */
  list(): readonly KeybindHandler[] {
    return this.handlers;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Test helper: drop all handlers and listeners. */
  reset(): void {
    this.handlers.length = 0;
    this.listeners.clear();
  }

  /** Test helper: count handlers. */
  size(): number {
    return this.handlers.length;
  }

  private bump(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* listener errors must not break the registry */
      }
    }
  }
}

export const TUI_KEYBINDS = new KeybindRegistry();
