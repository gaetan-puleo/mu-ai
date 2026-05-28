/**
 * Pure status-line data helpers — no rendering, no transport. Hosts compose
 * the strings here and feed them into their own surface (`mu-tui` text
 * component, WS payload, etc.).
 */

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** `1532 → "1.5k"`, small numbers stay plain. */
export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(n));
}

/** Pick the spinner glyph for tick `t`. Cycles through 10 braille frames. */
export function spinnerFrame(tick: number): string {
  return SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
}

export interface StatusParts {
  /** Left-aligned segments — joined with ` · `. */
  left: string[];
  /** Right-aligned segments — joined with ` · `. */
  right: string[];
}

/**
 * Build a default `StatusParts` shape from the optional context summary
 * (e.g. `"1.2k/4k used"`). Hosts call this and then push their own segments
 * onto `left`/`right` before rendering.
 */
export function buildStatusParts(contextText: string | undefined): StatusParts {
  return { left: [], right: contextText ? [contextText] : [] };
}

/**
 * Default mapping from a CoreEvent type to a one-word status label every
 * chat UI tends to display (`'ready'` / `'streaming...'` / `'reasoning...'`
 * / `'tool: <name>'` / `'error'`). Returns `undefined` when the event
 * shouldn't change the displayed status.
 */
import type { CoreEvent } from 'mu-core';

export function statusFromEvent(event: CoreEvent): string | undefined {
  switch (event.type) {
    case 'assistant_start':
    case 'assistant_delta':
      return 'streaming...';
    case 'assistant_message':
    case 'tool_result':
      return 'ready';
    case 'reasoning_delta':
    case 'reasoning_message':
      return 'reasoning...';
    case 'tool_call':
      return `tool: ${event.call.name}`;
    case 'error':
      return 'error';
    default:
      return undefined;
  }
}
