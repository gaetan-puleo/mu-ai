// Matches xterm SGR (1006) mouse-event sequences after Ink has stripped the
// leading \x1b. Format: \x1b[<button;x;y[Mm]
//   - M = press / motion
//   - m = release
// Examples: "[<0;126;31M", "[<32;36;51M", "[<0;31;51m"
export const SGR_MOUSE_RE = /\[<\d+;\d+;\d+[Mm]/g;

const SGR_MOUSE_EXACT_RE = /^\[<\d+;\d+;\d+[Mm]$/;

/** Single-event chunk (Ink usually delivers one event per input call). */
export function isMouseSequence(input: string): boolean {
  return SGR_MOUSE_EXACT_RE.test(input);
}

/**
 * Strip terminal-input bytes that should never become text:
 *  1. Any embedded SGR mouse-event sequences (clicks/drags/release/wheel).
 *  2. ASCII control bytes < 0x20 *except* \t and \n which paste should keep.
 *
 * Multi-event chunks (e.g. fast clicks batched into one data frame) are
 * handled because the regex is global.
 */
export function sanitizeTerminalInput(text: string): string {
  const stripped = text.replace(SGR_MOUSE_RE, '');
  let out = '';
  for (const ch of stripped) {
    const code = ch.charCodeAt(0);
    if (ch === '\t' || ch === '\n' || code >= 0x20) {
      out += ch;
    }
  }
  return out;
}
