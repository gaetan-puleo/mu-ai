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
}
