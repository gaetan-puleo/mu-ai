import type { InputEvent } from './events';

export interface KeyChord {
  key?: string;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
}

export interface GlobalKeybinding {
  chord: KeyChord;
  handler: () => void;
}

export function keyMatches(chord: KeyChord, event: InputEvent): boolean {
  if (event.type !== 'key') return false;
  if (chord.key !== undefined && chord.key !== event.key) return false;
  const fields: Array<keyof KeyChord> = ['shift', 'ctrl', 'meta', 'alt'];
  for (const field of fields) {
    const want = chord[field] ?? false;
    const got = (event as unknown as Record<string, boolean | undefined>)[field] ?? false;
    if (want !== got) return false;
  }
  return true;
}
