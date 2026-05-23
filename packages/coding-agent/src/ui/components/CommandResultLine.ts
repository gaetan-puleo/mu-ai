import type { Component, LayoutStyle, RenderContext } from 'mu-tui';
import { truncateToWidth, visibleWidth } from 'mu-tui';
import { getTheme, styleToAnsi } from '../theme';

const RESET = '\x1b[0m';

export class CommandResultLine implements Component {
  layout: LayoutStyle = { width: 'fill', height: 1, padding: { left: 1, right: 1 }, margin: { bottom: 1 } };

  constructor(private readonly content: string) {}

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const theme = getTheme(ctx);
    const prefix = styleToAnsi(theme.styles.muted);
    const fitted = visibleWidth(this.content) > width ? truncateToWidth(this.content, width) : this.content;
    return [prefix ? `${prefix}${fitted}${RESET}` : fitted];
  }
}
