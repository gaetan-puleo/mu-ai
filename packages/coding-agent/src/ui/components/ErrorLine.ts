import type { Component, LayoutStyle, RenderContext } from 'mu-tui';
import { getTheme, styleToAnsi } from '../theme';

const RESET = '\x1b[0m';

export class ErrorLine implements Component {
  layout: LayoutStyle;
  private content: string;

  constructor(content: string) {
    this.content = content;
    this.layout = { width: 'fill', height: 'auto' };
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const theme = getTheme(ctx);
    const prefixSgr = styleToAnsi(theme.styles.errorPrefix);
    const bodySgr = styleToAnsi(theme.styles.errorLine);
    const head = prefixSgr ? `${prefixSgr}! ${RESET}` : '! ';
    const body = bodySgr ? `${bodySgr}${this.content}${RESET}` : this.content;
    return [`${head}${body}`];
  }
}
