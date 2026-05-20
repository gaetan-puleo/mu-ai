/** Mouse button type for click/press events. */
export type MouseButton = 'left' | 'right' | 'middle' | 'scrollUp' | 'scrollDown';

/** Mouse movement type. */
export type MouseMotion = 'press' | 'release' | 'drag' | 'motion';

/** Parsed mouse event from terminal input. */
export interface MouseEvent {
  x: number;
  y: number;
  button: MouseButton;
  motion: MouseMotion;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
}
