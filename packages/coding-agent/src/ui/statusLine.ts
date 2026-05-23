import type { Component, LayoutStyle, RenderContext } from 'mu-tui';
import { visibleWidth } from 'mu-tui';
import { getTheme, styleToAnsi } from './theme';

const RESET = '\x1b[0m';
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function renderSpinnerFrame(tick: number): string {
  return `\x1b[2m${SPINNER_FRAMES[tick % SPINNER_FRAMES.length]}${RESET}`;
}

export class StatusLine implements Component {
  layout: LayoutStyle;
  private leftParts: string[] = [];
  private rightParts: string[] = [];
  private busy = false;
  private spinnerTick = 0;

  constructor() {
    this.layout = { width: 'fill', height: 1, zIndex: 10 };
  }

  setContent(leftParts: string[], rightParts: string[]): void {
    this.leftParts = leftParts;
    this.rightParts = rightParts;
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
  }

  setSpinnerTick(tick: number): void {
    this.spinnerTick = tick;
  }

  render(ctx: RenderContext): string[] {
    const theme = getTheme(ctx);
    const prefix = styleToAnsi(theme.styles.muted);
    const leftText = this.leftParts.join(' · ');
    const rightText = this.rightParts.join(' · ');
    const styledLeftText = prefix && leftText ? `${prefix}${leftText}${RESET}` : leftText;
    const styledRightText = prefix && rightText ? `${prefix}${rightText}${RESET}` : rightText;
    const left = this.busy
      ? `${renderSpinnerFrame(this.spinnerTick)}${styledLeftText ? ` ${styledLeftText}` : ''}`
      : styledLeftText;
    const leftWidth = visibleWidth(left);
    const rightWidth = visibleWidth(rightText);
    const gap = Math.max(1, ctx.contentRect.width - leftWidth - rightWidth);
    const text = rightText ? `${left}${' '.repeat(gap)}${styledRightText}` : left;
    const padded = text.padEnd(ctx.contentRect.width, ' ');
    return [padded];
  }
}
