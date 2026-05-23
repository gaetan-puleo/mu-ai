import type { Component, Constraints, LayoutStyle, RenderContext, Size } from 'mu-tui';
import { truncateToWidth, visibleWidth, wrapText } from 'mu-tui';
import { getTheme, styleToAnsi } from '../theme';

export interface ReasoningBlockProps {
  content: string;
  layout?: LayoutStyle;
}

const RESET = '\x1b[0m';

export class ReasoningBlock implements Component {
  layout: LayoutStyle;
  private content: string;

  constructor(props: ReasoningBlockProps) {
    this.content = props.content;
    this.layout = { width: 'fill', height: 'auto', margin: { bottom: 1 }, ...props.layout };
  }

  setContent(content: string): void {
    this.content = content;
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const theme = getTheme(ctx);
    const prefix = styleToAnsi(theme.styles.reasoning);

    const lines = this.content.split('\n');
    const wrapped = lines.flatMap((line) => wrapText(line, width));
    const result: string[] = [];

    for (let i = 0; i < wrapped.length && result.length < height; i++) {
      const text = wrapped[i];
      const fitted = visibleWidth(text) > width ? truncateToWidth(text, width) : text;
      const padding = width - visibleWidth(fitted);
      const padded = padding > 0 ? fitted + ' '.repeat(padding) : fitted;
      result.push(prefix ? `${prefix}${padded}${RESET}` : padded);
    }

    return result;
  }

  measure(constraints: Constraints): Size {
    const maxWidth = Number.isFinite(constraints.maxWidth) ? Math.max(0, constraints.maxWidth) : 80;
    const lines = this.content.split('\n');
    const wrapped = lines.flatMap((line) => wrapText(line, maxWidth));
    let w = 0;
    for (const line of wrapped) {
      const cw = visibleWidth(line);
      if (cw > w) w = cw;
    }
    return { width: Math.min(w, maxWidth), height: wrapped.length };
  }
}
