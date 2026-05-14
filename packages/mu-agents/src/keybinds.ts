/**
 * Keybind channel — structural interface a host (typically the mu-coding
 * TUI) implements to let `mu-agents` contribute keyboard shortcuts.
 *
 * The interface intentionally mirrors mu-coding's `TUI_KEYBINDS`
 * registry so a host can pass the singleton in directly. mu-agents
 * never imports anything from mu-coding (would create a dependency
 * cycle); instead the host injects this channel through
 * `AgentsPluginOptions.keybinds`.
 *
 * The session resolver tells mu-agents which Session the user is
 * currently looking at when a keybind fires. Hosts that have no
 * concept of an "active session" (e.g. a headless bot) can omit the
 * whole `keybinds` option — the plugin then degrades gracefully and
 * skips its keybind registrations.
 */

import type { Session } from 'mu-core';

/** Subset of Ink's `KeyChord` shape, redeclared so mu-agents stays Ink-free. */
export interface KeyChord {
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
  return?: boolean;
  delete?: boolean;
  backspace?: boolean;
}

export interface KeybindHandler {
  chord: KeyChord;
  description: string;
  when?: () => boolean;
  run: () => boolean | void;
}

export interface KeybindRegistry {
  /** Register a handler; return a disposer that detaches it. */
  register(handler: KeybindHandler): () => void;
}

/**
 * Bundle of host capabilities mu-agents needs to wire keybinds:
 *
 *  - `registry`: where to register handlers (mu-coding passes its
 *    `TUI_KEYBINDS` singleton).
 *  - `currentSession`: resolves the session the keybind should act on,
 *    or null when no session is mounted.
 *
 * Hosts may omit the bundle entirely to opt out of keybind wiring.
 */
export interface KeybindChannel {
  registry: KeybindRegistry;
  currentSession: () => Session | null;
}
