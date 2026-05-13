import { useInput, type Key } from 'ink';
import { useRef } from 'react';

export interface ChordHandlers {
  /** Called for every key event; return true to stop default propagation. */
  onKey?: (input: string, key: Key) => boolean | void;
  /** Called when Ctrl-<letter> is pressed. */
  onCtrl?: (letter: string) => boolean | void;
  /** Called on Escape. */
  onEscape?: () => boolean | void;
  /** Called on Tab. */
  onTab?: () => boolean | void;
  /** Called on Shift-Tab. */
  onShiftTab?: () => boolean | void;
  /** Called on Enter (no shift). */
  onEnter?: () => boolean | void;
  /** Called on Up/Down arrows. */
  onArrowUp?: () => boolean | void;
  onArrowDown?: () => boolean | void;
  onArrowLeft?: () => boolean | void;
  onArrowRight?: () => boolean | void;
}

/**
 * Centralised keyboard handler. Wraps Ink's `useInput` with a handlers object.
 */
export function useChordKeyboard(handlers: ChordHandlers, enabled = true): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useInput(
    (input, key) => {
      const h = ref.current;
      if (h.onKey?.(input, key)) return;
      if (key.escape) {
        h.onEscape?.();
        return;
      }
      if (key.tab && key.shift) {
        h.onShiftTab?.();
        return;
      }
      if (key.tab) {
        h.onTab?.();
        return;
      }
      if (key.return) {
        h.onEnter?.();
        return;
      }
      if (key.upArrow) {
        h.onArrowUp?.();
        return;
      }
      if (key.downArrow) {
        h.onArrowDown?.();
        return;
      }
      if (key.leftArrow) {
        h.onArrowLeft?.();
        return;
      }
      if (key.rightArrow) {
        h.onArrowRight?.();
        return;
      }
      if (key.ctrl && input.length === 1) {
        h.onCtrl?.(input);
        return;
      }
    },
    { isActive: enabled },
  );
}
