import type { Component, Constraints, LayoutStyle, RenderContext, Size } from 'mu-tui';
import { visibleWidth, wrapText } from 'mu-tui';
import { styleToAnsi, type Theme } from '../theme';

const RESET = '\x1b[0m';

export interface ErrorOutputBlockProps {
  command: string;
  output: string;
  theme: Theme;
}

export class ErrorOutputBlock implements Component {
  layout: LayoutStyle;

  constructor(private readonly props: ErrorOutputBlockProps) {
    this.layout = {
      width: 'fill',
      height: 'auto',
      margin: { bottom: 1 },
      padding: { top: 1, right: 1, bottom: 1, left: 1 },
      backgroundColor: props.theme.colors.errorSurface,
    };
  }

  measure(constraints: Constraints): Size {
    const maxWidth = Number.isFinite(constraints.maxWidth)
      ? Math.max(0, constraints.maxWidth) - (this.layout.padding?.left ?? 0) - (this.layout.padding?.right ?? 0)
      : 80;
    const wrappedLines = wrapText(this.props.output, maxWidth);
    const height =
      1 +
      1 + // empty line between header and output
      wrappedLines.length +
      (this.layout.padding?.top ?? 0) +
      (this.layout.padding?.bottom ?? 0);
    let width = visibleWidth(this.props.command);
    for (const line of wrappedLines) {
      const w = visibleWidth(line);
      if (w > width) width = w;
    }
    return { width: width + (this.layout.padding?.left ?? 0) + (this.layout.padding?.right ?? 0), height };
  }

  render(ctx: RenderContext): string[] {
    const width = ctx.contentRect.width;
    if (width <= 0) return [];

    const headerStyle = styleToAnsi({ fg: this.props.theme.colors.textMuted });
    const outputStyle = styleToAnsi({ fg: this.props.theme.colors.text });
    const lines: string[] = [];

    lines.push(`${headerStyle}${this.props.command}${RESET}`);
    lines.push('');

    const innerWidth = width - (this.layout.padding?.left ?? 0) - (this.layout.padding?.right ?? 0);
    const wrappedLines = wrapText(this.props.output, innerWidth);
    for (const line of wrappedLines) {
      lines.push(`${outputStyle}${line}${RESET}`);
    }

    return lines;
  }
}
