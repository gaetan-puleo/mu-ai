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
  start?: (onInput: (data: string) => void, onResize: () => void) => void;
  stop?: () => void;
  readonly capabilities?: Capabilities;
}
