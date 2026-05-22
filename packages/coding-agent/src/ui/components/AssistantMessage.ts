import type { Component, Constraints, LayoutStyle, RenderContext, Size } from 'mu-tui';
import { truncateToWidth, visibleWidth, wrapText } from 'mu-tui';
import { Box } from 'mu-tui/components';
import { getTheme, styleToAnsi } from '../theme';

export interface AssistantMessageProps {
  content: string;
}

const RESET = '\x1b[0m';

class AssistantMessageBody implements Component {
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
    const prefix = styleToAnsi(theme.styles.assistantMessage);

    const wrapped = this.content.split('\n').flatMap((line) => wrapText(line, width));
    const result: string[] = [];
    for (let i = 0; i < wrapped.length && result.length < height; i++) {
      const line = wrapped[i];
      const fitted = visibleWidth(line) > width ? truncateToWidth(line, width) : line;
      result.push(prefix ? `${prefix}${fitted}${RESET}` : fitted);
    }
    return result;
  }

  measure(constraints: Constraints): Size {
    const maxWidth = Number.isFinite(constraints.maxWidth) ? Math.max(0, constraints.maxWidth) : 80;
    const wrapped = this.content.split('\n').flatMap((line) => wrapText(line, maxWidth));
    let w = 0;
    for (const line of wrapped) {
      const cw = visibleWidth(line);
      if (cw > w) w = cw;
    }
    return { width: Math.min(w, maxWidth), height: wrapped.length };
  }
}

export class AssistantMessage extends Box {
  constructor(props: AssistantMessageProps) {
    super({
      layout: {
        width: 'fill',
        height: 'auto',
        margin: { bottom: 1 },
        padding: { right: 1, left: 1 },
      },
      children: [new AssistantMessageBody(props.content)],
    });
  }
}
