import type { Component, InputEvent, LayoutStyle, RenderContext } from 'mu-tui';
import { truncateToWidth, visibleWidth } from 'mu-tui';
import { getTheme, styleToAnsi } from '../theme';

const RESET = '\x1b[0m';

export class HiddenThinkingLine implements Component {
  layout: LayoutStyle = { width: 'fill', height: 1, padding: { left: 1, right: 1 }, margin: { bottom: 1 } };

  constructor(private readonly onOpen: () => void) {}

  handleEvent(event: InputEvent): void {
    if (event.type === 'mouse' && event.kind === 'press' && event.button === 'left') {
      this.onOpen();
    }
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const theme = getTheme(ctx);
    const prefix = styleToAnsi(theme.styles.reasoning);
    const text = '[thinking]';
    const fitted = visibleWidth(text) > width ? truncateToWidth(text, width) : text;
    return [prefix ? `${prefix}${fitted}${RESET}` : fitted];
  }
}
