import type { Component } from 'mu-tui';
import { truncateToWidth, visibleWidth } from 'mu-tui';
import type { AgentSessionEvent } from 'mu-harness';
import { styleToAnsi, type Theme } from './theme';

const RESET = '\x1b[0m';
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const spinnerFrame = (tick: number): string =>
  SPINNER[((tick % SPINNER.length) + SPINNER.length) % SPINNER.length];

export const formatTokens = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(Math.round(n));

export interface StatusState {
  label: string;
  busy: boolean;
  spinnerTick: number;
  context: string;
  /** Lean mode: hide the context readout, leaving only a busy spinner. */
  minimal?: boolean;
}

export function statusFromEvent(event: AgentSessionEvent): string | undefined {
  switch (event.type) {
    case 'turn_start':
      return 'thinking…';
    case 'reasoning':
      return 'reasoning…';
    case 'text':
      return 'responding…';
    case 'tool_call':
      return `calling ${event.name}…`;
    case 'message':
      return event.message.role === 'assistant' ? undefined : 'running…';
    case 'turn_end':
    case 'done':
      return 'ready';
    case 'error':
      return 'error';
    default:
      return undefined;
  }
}

export function statusComponent(state: StatusState, theme: Theme): Component {
  return {
    render: (s) => {
      if (s.width <= 0) return;
      const muted = styleToAnsi(theme.styles.muted);
      const spinner = `${muted}${spinnerFrame(state.spinnerTick)}${RESET}`;
      const left = state.busy ? (state.label ? `${spinner} ${muted}${state.label}${RESET}` : spinner) : '';
      const right = state.minimal ? '' : (state.context ? `${muted}${state.context}${RESET}` : '');
      if (!left && !right) {
        s.text(0, 0, '');
        return;
      }
      const gap = Math.max(1, s.width - visibleWidth(left) - visibleWidth(right));
      const line = right ? `${left}${' '.repeat(gap)}${right}` : left;
      s.text(0, 0, visibleWidth(line) > s.width ? truncateToWidth(line, s.width) : line);
    },
  };
}
