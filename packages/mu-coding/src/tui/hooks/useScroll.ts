import { useInput, useStdout } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';

const SCROLL_STEP = 3;

export function useScroll(contentHeight: number, viewHeight: number) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const autoScrollRef = useRef(true);
  const maxScroll = Math.max(0, contentHeight - viewHeight);

  // Enable SGR mouse mode (1000 = press/release+wheel only, no drag motion;
  // 1006 = SGR-encoded coordinates) so wheel sequences arrive through Ink's
  // input pipeline. Mode 1002 (button-event w/ drag) was previously used but
  // produced spurious "[<32;...M" drag events that leaked into text inputs.
  //
  // On cleanup we defensively disable 1000/1002/1003 — any of them might be
  // active from a prior session/binary/extension and disabling already-off
  // modes is a no-op. Without this, mouse tracking can leak into the parent
  // shell after abort.
  const { stdout } = useStdout();
  useEffect(() => {
    stdout.write('\x1b[?1000h\x1b[?1006h');
    return () => {
      stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l');
    };
  }, [stdout]);

  useEffect(() => {
    if (autoScrollRef.current && contentHeight > viewHeight) {
      setScrollOffset(contentHeight - viewHeight);
    }
  }, [contentHeight, viewHeight]);

  const scrollUp = useCallback(() => {
    autoScrollRef.current = false;
    setScrollOffset((o) => Math.max(0, o - SCROLL_STEP));
  }, []);

  const scrollDown = useCallback(() => {
    setScrollOffset((o) => {
      const next = Math.min(maxScroll, o + SCROLL_STEP);
      if (next >= maxScroll) {
        autoScrollRef.current = true;
      }
      return next;
    });
  }, [maxScroll]);

  // Detect SGR mouse wheel sequences via Ink's useInput hook.
  // Ink's parseKeypress doesn't recognize SGR mouse, so raw sequences
  // pass through with \x1b stripped: [<64;... (up), [<65;... (down)
  useInput(
    (input) => {
      if (input.startsWith('[<64')) {
        scrollUp();
      } else if (input.startsWith('[<65')) {
        scrollDown();
      }
    },
    { isActive: true },
  );

  return { scrollOffset, onScrollUp: scrollUp, onScrollDown: scrollDown };
}
