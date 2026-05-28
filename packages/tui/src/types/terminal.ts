import type { Capabilities } from '../capabilities';

export type TerminalMode =
  | 'alternateScreen'
  | 'bracketedPaste'
  | 'focusEvents'
  | 'sgrMouse'
  | 'mouseDrag'
  | 'mouseMotion'
  | 'pixelMouse'
  | 'synchronizedOutput'
  | 'kittyKeyboard'
  | 'modifyOtherKeys';

/** Terminal interface — abstracts terminal I/O. */
export interface Terminal {
  readonly columns: number;
  readonly rows: number;
  write: (data: string) => void;
  hideCursor: () => void;
  showCursor: () => void;
  clearScreen: () => void;
  clearLine: () => void;
  clearFromCursor: () => void;
  moveBy: (lines: number) => void;
  enableMode?: (mode: TerminalMode) => void;
  disableMode?: (mode: TerminalMode) => void;
  enableMouse?: () => void;
  disableMouse?: () => void;
  /**
   * Optional lifecycle hooks for terminals that own raw-mode + input
   * subscription (process stdin). Off-thread terminals (tests, embedded
   * surfaces) can omit them.
   */
  start?: (onInput: (data: string) => void, onResize: () => void) => void;
  stop?: () => void;
  /**
   * Hint about the terminal's detected capability set. `TUI` merges this with
   * any user-supplied capability overrides at construction time. Off-thread
   * terminals can omit and let `TUI` fall back to defaults.
   */
  readonly capabilities?: Capabilities;
}
