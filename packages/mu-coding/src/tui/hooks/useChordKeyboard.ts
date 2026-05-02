/**
 * Two-key emacs-style chord prefix.
 *
 * `useChordKeyboard` takes a prefix predicate (e.g. "Ctrl+X") and a map of
 * follow-up handlers. Pressing the prefix arms a chord state for
 * `timeoutMs` (default 1000); the next key event dispatches to the
 * matching handler, or — if nothing matches before the timer fires — the
 * chord is dropped silently.
 *
 * Integrates with Ink's `useInput` so it cooperates with the rest of the
 * keyboard pipeline; keys consumed while armed are swallowed regardless of
 * whether they matched a follow-up handler, so a stray `g` after `Ctrl+X`
 * does not leak into the chat input.
 */

import { type Key, useInput } from 'ink';
import { useEffect, useRef } from 'react';

export interface ChordKey {
  /** Lower-case input character, when the press produced one. */
  input: string;
  /** Modifiers / arrow keys provided by Ink. */
  key: Key;
}

export type ChordPredicate = (k: ChordKey) => boolean;
export type ChordHandler = () => void;

export interface ChordSpec {
  /** Predicate matching the prefix (e.g. `({key, input}) => key.ctrl && input === 'x'`). */
  prefix: ChordPredicate;
  /**
   * Follow-up handlers. The first matching predicate (by insertion order)
   * runs; non-matching follow-ups still consume the key and clear the
   * armed state — i.e. the chord is "spent" on any keypress.
   */
  followUps: Array<{
    match: ChordPredicate;
    handler: ChordHandler;
  }>;
  /** When false, the hook is dormant. Defaults to `true`. */
  isActive?: boolean;
  /** Window after the prefix during which a follow-up is accepted. */
  timeoutMs?: number;
}

export function useChordKeyboard(spec: ChordSpec): void {
  const armedRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutMs = spec.timeoutMs ?? 1000;

  // Clear any pending timer if the component using the hook unmounts mid-chord.
  useEffect(() => {
    return () => {
      if (armedRef.current) {
        clearTimeout(armedRef.current);
        armedRef.current = null;
      }
    };
  }, []);

  useInput(
    (input, key) => {
      const event: ChordKey = { input, key };

      if (armedRef.current) {
        // We're inside the chord window. Any keypress consumes the chord;
        // dispatch when one of the follow-ups matches.
        clearTimeout(armedRef.current);
        armedRef.current = null;
        for (const fu of spec.followUps) {
          if (fu.match(event)) {
            fu.handler();
            return;
          }
        }
        return;
      }

      if (spec.prefix(event)) {
        armedRef.current = setTimeout(() => {
          armedRef.current = null;
        }, timeoutMs);
      }
    },
    { isActive: spec.isActive ?? true },
  );
}
