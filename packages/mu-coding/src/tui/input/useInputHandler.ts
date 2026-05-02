import { type Key, useInput, useStdin } from 'ink';
import type { ShortcutHandler } from 'mu-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { matchCommands, type SlashCommand } from './commands';
import {
  type BufferState,
  cursorRowCol,
  deleteBackward,
  deleteForward,
  deleteWordBackward,
  insertAt,
  killToLineEnd,
  killToLineStart,
  moveLeft,
  moveLineDown,
  moveLineEnd,
  moveLineHome,
  moveLineUp,
  moveRight,
  moveWordLeft,
  moveWordRight,
} from './cursor';
import { isMouseSequence, sanitizeTerminalInput } from './sanitize';

const BACKSPACE_BYTES = new Set(['\x7f', '\x08']);

export interface InputActions {
  onCtrlC?: () => void;
  onPaste?: () => void;
  onNew?: () => void;
  onCompact?: () => void;
  onCycleModel?: () => void;
  onTogglePicker?: () => void;
  onToggleSessionPicker?: () => void;
  onShowContext?: () => void;
  onEsc?: () => void;
  onScrollUp?: () => void;
  onScrollDown?: () => void;
  onUpdate?: (args: string) => void;
  modelCount?: number;
}

interface InputState {
  value: string;
  cursor: number;
  commands: SlashCommand[];
  cmdIndex: number;
  isCommandMode: boolean;
}

/**
 * Optional mention-picker controls. When `active`, navigation keys (↑/↓) and
 * accept keys (Tab / Enter) are routed through this handle instead of the
 * default editing bindings. Read via a ref so the dispatch closure always
 * sees the latest snapshot without forcing a hook re-call.
 */
export interface MentionMode {
  active: boolean;
  count: number;
  selectedIndex: number;
  next: () => void;
  prev: () => void;
  accept: () => void;
}

interface UseInputHandlerOptions {
  isActive: boolean;
  streaming: boolean;
  history: string[];
  actions: InputActions;
  onSubmit: (text: string) => void;
  availableCommands: SlashCommand[];
  onCommand: (command: SlashCommand, args: string) => void;
  /**
   * Plugin-registered keyboard shortcuts. Consulted before the built-in
   * BINDINGS table; whenever a handler is registered for the pressed key id
   * the default editor binding is skipped entirely. Handlers are fire-and-
   * forget so the input loop never blocks on plugin work.
   */
  pluginShortcuts?: Map<string, ShortcutHandler>;
  /**
   * Ref to the current mention-mode controls. The picker state is computed
   * by the caller (which depends on `value`/`cursor` from this hook) and
   * pushed into the ref every render; the dispatch closure reads it at key
   * time. Avoids calling `useInputHandler` twice to break the dependency.
   */
  mentionRef?: React.RefObject<MentionMode | null>;
}

// Build a stable key identifier from an Ink key event. The id is a flat
// string so the BINDINGS map can be a plain dictionary and adding a new
// shortcut means adding one line. Split into two helpers to keep cognitive
// complexity within Biome's threshold.
function modifierKeyId(input: string, key: Key): string | null {
  if (key.ctrl && key.shift && input) return `ctrl+shift+${input}`;
  if (key.ctrl && key.leftArrow) return 'ctrl+left';
  if (key.ctrl && key.rightArrow) return 'ctrl+right';
  if (key.ctrl && input) return `ctrl+${input}`;
  if (key.meta && key.leftArrow) return 'alt+left';
  if (key.meta && key.rightArrow) return 'alt+right';
  return null;
}

const DIRECT_KEYS: ReadonlyArray<readonly [keyof Key, string]> = [
  ['escape', 'escape'],
  ['pageUp', 'pageup'],
  ['pageDown', 'pagedown'],
  ['tab', 'tab'],
  ['upArrow', 'up'],
  ['downArrow', 'down'],
  ['leftArrow', 'left'],
  ['rightArrow', 'right'],
  ['home', 'home'],
  ['end', 'end'],
  ['delete', 'delete'],
  ['backspace', 'backspace'],
];

function keyId(input: string, key: Key): string | null {
  const mod = modifierKeyId(input, key);
  if (mod) return mod;
  if (key.return) return key.shift ? 'shift+return' : 'return';
  for (const [flag, id] of DIRECT_KEYS) {
    if (key[flag]) return id;
  }
  return null;
}

function useHistoryNavigation(state: BufferState, history: string[]) {
  const idx = useRef(-1);
  const draft = useRef('');

  const up = (): string | null => {
    if (!history.length) return null;
    if (idx.current === -1) {
      draft.current = state.value;
      idx.current = history.length - 1;
    } else if (idx.current > 0) {
      idx.current -= 1;
    }
    return history[idx.current] ?? null;
  };

  const down = (): string | null => {
    if (idx.current === -1) return null;
    if (idx.current < history.length - 1) {
      idx.current += 1;
      return history[idx.current] ?? null;
    }
    idx.current = -1;
    return draft.current;
  };

  return { up, down, reset: () => (idx.current = -1) };
}

/**
 * Some terminals (and Ink versions) deliver `\x7f` / `\x08` as raw stdin
 * bytes without firing `useInput`'s `key.backspace`. We listen at the raw
 * level and let the React handler consume the synthetic flag.
 */
function useRawBackspace(isActive: boolean, onBackspace: () => void) {
  const { stdin } = useStdin();
  const handledRef = useRef(false);
  const callbackRef = useRef(onBackspace);
  callbackRef.current = onBackspace;

  useEffect(() => {
    if (!(stdin && isActive)) return;
    const onData = (data: Buffer) => {
      if (BACKSPACE_BYTES.has(data.toString())) {
        handledRef.current = true;
        callbackRef.current();
      }
    };
    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
    };
  }, [stdin, isActive]);

  return handledRef;
}

interface BindingCtx {
  state: BufferState;
  setState: React.Dispatch<React.SetStateAction<BufferState>>;
  setCmdIndex: React.Dispatch<React.SetStateAction<number>>;
  desiredColumn: React.MutableRefObject<number | null>;
  nav: ReturnType<typeof useHistoryNavigation>;
  submit: () => void;
  isCommandMode: boolean;
  commands: SlashCommand[];
  actions: InputActions;
  mentionRef?: React.RefObject<MentionMode | null>;
}

function getMention(c: BindingCtx): MentionMode | null {
  return c.mentionRef?.current ?? null;
}

type Binding = (ctx: BindingCtx) => void;

// ─── Vertical movement: routed through history when at edges ─────────────────
//
// Pressing ↑ on the first row of a multi-line buffer (or single-line) goes to
// history. Pressing ↑ further up inside the buffer just moves the cursor.
// Mirroring fish/zsh's behaviour. Same for ↓ on the last row.

function handleUp(c: BindingCtx): void {
  const m = getMention(c);
  if (m?.active && m.count > 0) {
    m.prev();
    return;
  }
  if (c.isCommandMode) {
    c.setCmdIndex((i) => (i > 0 ? i - 1 : c.commands.length - 1));
    return;
  }
  const { row, col } = cursorRowCol(c.state.value, c.state.cursor);
  if (row > 0) {
    if (c.desiredColumn.current === null) c.desiredColumn.current = col;
    const next = moveLineUp(c.state, c.desiredColumn.current);
    if (next) c.setState(next);
    return;
  }
  c.desiredColumn.current = null;
  const r = c.nav.up();
  if (r !== null) c.setState({ value: r, cursor: r.length });
}

function handleDown(c: BindingCtx): void {
  const m = getMention(c);
  if (m?.active && m.count > 0) {
    m.next();
    return;
  }
  if (c.isCommandMode) {
    c.setCmdIndex((i) => (i < c.commands.length - 1 ? i + 1 : 0));
    return;
  }
  const { row, col } = cursorRowCol(c.state.value, c.state.cursor);
  const total = c.state.value.split('\n').length;
  if (row < total - 1) {
    if (c.desiredColumn.current === null) c.desiredColumn.current = col;
    const next = moveLineDown(c.state, c.desiredColumn.current);
    if (next) c.setState(next);
    return;
  }
  c.desiredColumn.current = null;
  const r = c.nav.down();
  if (r !== null) c.setState({ value: r, cursor: r.length });
}

function handleTab(c: BindingCtx): void {
  const m = getMention(c);
  if (m?.active && m.count > 0) {
    m.accept();
    return;
  }
  c.setState((s) => insertAt(s, '  '));
}

function handleReturn(c: BindingCtx): void {
  const m = getMention(c);
  if (m?.active && m.count > 0) {
    m.accept();
    return;
  }
  c.submit();
}

// ─── Bindings ────────────────────────────────────────────────────────────────

const BINDINGS: Record<string, Binding> = {
  'ctrl+c': (c) => c.actions.onCtrlC?.(),
  'ctrl+v': (c) => c.actions.onPaste?.(),
  'ctrl+o': (c) => c.actions.onTogglePicker?.(),
  'ctrl+s': (c) => c.submit(),
  'ctrl+j': (c) => c.setState((s) => insertAt(s, '\n')),
  'ctrl+a': (c) => c.setState((s) => moveLineHome(s)),
  'ctrl+e': (c) => c.setState((s) => moveLineEnd(s)),
  'ctrl+w': (c) => c.setState((s) => deleteWordBackward(s)),
  'ctrl+u': (c) => c.setState((s) => killToLineStart(s)),
  'ctrl+k': (c) => c.setState((s) => killToLineEnd(s)),
  'ctrl+left': (c) => c.setState((s) => moveWordLeft(s)),
  'ctrl+right': (c) => c.setState((s) => moveWordRight(s)),
  'alt+left': (c) => c.setState((s) => moveWordLeft(s)),
  'alt+right': (c) => c.setState((s) => moveWordRight(s)),
  'ctrl+m': (c) => {
    if (c.actions.modelCount) c.actions.onCycleModel?.();
  },
  'ctrl+n': (c) => {
    c.actions.onNew?.();
    c.setState({ value: '', cursor: 0 });
    c.nav.reset();
  },
  escape: (c) => c.actions.onEsc?.(),
  pageup: (c) => c.actions.onScrollUp?.(),
  pagedown: (c) => c.actions.onScrollDown?.(),
  'shift+return': (c) => c.setState((s) => insertAt(s, '\n')),
  return: handleReturn,
  tab: handleTab,
  up: handleUp,
  down: handleDown,
  left: (c) => c.setState((s) => moveLeft(s)),
  right: (c) => c.setState((s) => moveRight(s)),
  home: (c) => c.setState((s) => moveLineHome(s)),
  end: (c) => c.setState((s) => moveLineEnd(s)),
  delete: (c) => {
    c.setState((s) => deleteForward(s));
    c.nav.reset();
  },
};

// Keys that shouldn't reset the sticky vertical column. Anything else
// (typing, deleting, switching lines explicitly) drops the sticky column.
const COLUMN_PRESERVING = new Set(['up', 'down']);

function applyBackspace(c: BindingCtx): void {
  c.setState((s) => deleteBackward(s));
  c.nav.reset();
}

function handleInsert(input: string, c: BindingCtx): void {
  if (!input) return;
  const sanitized = sanitizeTerminalInput(input);
  if (!sanitized) return;
  c.setState((s) => insertAt(s, sanitized));
  c.nav.reset();
}

export function useInputHandler(
  options: UseInputHandlerOptions,
): InputState & { setBuffer: (value: string, cursor: number) => void } {
  const { isActive, streaming, history, actions, onSubmit, availableCommands, onCommand, pluginShortcuts, mentionRef } =
    options;
  const [state, setState] = useState<BufferState>({ value: '', cursor: 0 });
  const [cmdIndex, setCmdIndex] = useState(0);
  const desiredColumn = useRef<number | null>(null);
  const nav = useHistoryNavigation(state, history);
  // Keep the latest map in a ref so the dispatchKey closure (created once
  // per `useInput` call) always sees the freshest handlers without forcing
  // a re-subscribe.
  const pluginShortcutsRef = useRef(pluginShortcuts);
  pluginShortcutsRef.current = pluginShortcuts;

  const onRawBackspace = useCallback(() => {
    setState((s) => deleteBackward(s));
    nav.reset();
  }, [nav]);
  const backspaceHandledRef = useRawBackspace(isActive, onRawBackspace);

  const commands = useMemo(
    () => matchCommands(state.value.trim(), availableCommands),
    [state.value, availableCommands],
  );
  const isCommandMode = commands.length > 0 && state.value.trim().startsWith('/');

  const submit = useCallback(() => {
    if (streaming) return;
    if (isCommandMode) {
      const cmd = commands[cmdIndex];
      if (cmd) {
        const args = state.value.trim().slice(cmd.name.length).trim();
        setState({ value: '', cursor: 0 });
        onCommand(cmd, args);
      }
      return;
    }
    if (!state.value.trim()) return;
    onSubmit(state.value);
    setState({ value: '', cursor: 0 });
    nav.reset();
  }, [streaming, isCommandMode, commands, cmdIndex, state.value, onCommand, onSubmit, nav]);

  useInput(
    dispatchKey({
      state,
      setState,
      setCmdIndex,
      desiredColumn,
      nav,
      submit,
      isCommandMode,
      commands,
      actions,
      mentionRef,
      backspaceHandledRef,
      pluginShortcutsRef,
    }),
    { isActive },
  );

  const setBuffer = useCallback(
    (value: string, cursor: number) => {
      setState({ value, cursor });
      nav.reset();
    },
    [nav],
  );

  return { value: state.value, cursor: state.cursor, commands, cmdIndex, isCommandMode, setBuffer };
}

interface DispatchOptions extends BindingCtx {
  backspaceHandledRef: React.MutableRefObject<boolean>;
  pluginShortcutsRef: React.MutableRefObject<Map<string, ShortcutHandler> | undefined>;
}

/**
 * Try to dispatch a key id to a plugin-registered handler. Returns `true` when
 * the key was claimed (so the default binding shouldn't fire). The async
 * handler is fire-and-forget: plugins typically mutate their own state and
 * surface results via `MessageBus.append`, so we don't need to await here.
 */
function tryPluginShortcut(id: string, opts: DispatchOptions): boolean {
  const handlers = opts.pluginShortcutsRef.current;
  const handler = handlers?.get(id);
  if (!handler) return false;
  void Promise.resolve(handler()).catch(() => {
    /* swallow handler errors so a misbehaving plugin can't kill the input loop */
  });
  return true;
}

/**
 * Build the key handler for `useInput`. Extracted so the hook body stays
 * under Biome's per-function line cap and so the binding lookup is testable
 * in isolation if we ever need it.
 */
function dispatchKey(opts: DispatchOptions): (input: string, key: Key) => void {
  return (input, key) => {
    if (isMouseSequence(input)) return;
    const alreadyHandled = opts.backspaceHandledRef.current;
    opts.backspaceHandledRef.current = false;

    const id = keyId(input, key);
    if (id && !COLUMN_PRESERVING.has(id)) opts.desiredColumn.current = null;

    if (id === 'backspace') {
      if (!alreadyHandled) applyBackspace(opts);
      else opts.nav.reset();
      return;
    }
    if (id && tryPluginShortcut(id, opts)) {
      return;
    }
    if (id && BINDINGS[id]) {
      BINDINGS[id](opts);
      return;
    }
    handleInsert(input, opts);
  };
}
