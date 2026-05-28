import type { InputEvent, KeyInputEvent } from './events';

export interface KeyChord {
  key?: string;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
}

export interface GlobalKeybinding {
  chord: KeyChord;
  handler: (event: KeyInputEvent) => void;
}

export function keyMatches(chord: KeyChord, event: InputEvent): boolean {
  if (event.type !== 'key') return false;
  if (chord.key !== undefined && chord.key !== event.key) return false;
  if ((chord.shift ?? false) !== event.shift) return false;
  if ((chord.ctrl ?? false) !== event.ctrl) return false;
  if ((chord.meta ?? false) !== event.meta) return false;
  if ((chord.alt ?? false) !== event.alt) return false;
  return true;
}
