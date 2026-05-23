import type { Component, LayoutStyle, RenderContext } from 'mu-tui';
import { getTheme, styleToAnsi } from '../theme';

const RESET = '\x1b[0m';

export class ErrorToast implements Component {
  layout: LayoutStyle;

  constructor(private readonly content: string) {
    this.layout = { width: 'fill', height: 'auto', padding: { left: 1, right: 1, bottom: 1 }, zIndex: 20 };
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const theme = getTheme(ctx);
    const prefixSgr = styleToAnsi(theme.styles.errorPrefix);
    const bodySgr = styleToAnsi(theme.styles.errorLine);
    const maxTextWidth = Math.max(0, width - 4);
    const text =
      this.content.length > maxTextWidth ? `${this.content.slice(0, Math.max(0, maxTextWidth - 3))}...` : this.content;
    const prefix = prefixSgr ? `${prefixSgr}!${RESET}` : '!';
    const body = bodySgr ? `${bodySgr}${text}${RESET}` : text;
    return [`${prefix} ${body}`.padEnd(width, ' ')];
  }
}
