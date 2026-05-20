export interface Modifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

export type KeyEventKind = 'press' | 'repeat' | 'release';

export interface KeyInputEvent extends Modifiers {
  type: 'key';
  key: string;
  kind: KeyEventKind;
  text?: string;
  source: 'legacy' | 'xterm' | 'csi-u' | 'kitty' | 'unknown';
  raw: string;
}

export interface TextInputEvent {
  type: 'text';
  text: string;
  raw: string;
}

export type MouseButton =
  | 'left'
  | 'middle'
  | 'right'
  | 'wheelUp'
  | 'wheelDown'
  | 'wheelLeft'
  | 'wheelRight'
  | 'unknown';
export type MouseEventKind = 'press' | 'release' | 'drag' | 'move' | 'wheel';

export interface MouseInputEvent extends Modifiers {
  type: 'mouse';
  kind: MouseEventKind;
  button: MouseButton;
  x: number;
  y: number;
  coordinateSpace: 'cells' | 'pixels';
  source: 'sgr' | 'x10' | 'urxvt' | 'pixel' | 'unknown';
  raw: string;
}

export interface PasteInputEvent {
  type: 'paste';
  text: string;
  raw: string;
}

export interface FocusInputEvent {
  type: 'focus';
  focused: boolean;
  raw: string;
}

export interface ResizeInputEvent {
  type: 'resize';
  columns: number;
  rows: number;
}

export interface TerminalResponseEvent {
  type: 'terminalResponse';
  raw: string;
  sequence: 'csi' | 'osc' | 'dcs' | 'apc' | 'pm' | 'sos' | 'escape' | 'unknown';
}

export type InputEvent =
  | KeyInputEvent
  | TextInputEvent
  | MouseInputEvent
  | PasteInputEvent
  | FocusInputEvent
  | ResizeInputEvent
  | TerminalResponseEvent;

export const NO_MODIFIERS: Modifiers = {
  shift: false,
  ctrl: false,
  alt: false,
  meta: false,
};
