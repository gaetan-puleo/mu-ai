import type { Component, Constraints, LayoutStyle, RenderContext, Size } from 'mu-tui';
import { visibleWidth, wrapText } from 'mu-tui';
import { styleToAnsi, type Theme } from '../theme';

const RESET = '\x1b[0m';

function normalizePadding(padding: LayoutStyle['padding']) {
  if (typeof padding === 'number') {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  return {
    top: padding?.top ?? 0,
    right: padding?.right ?? 0,
    bottom: padding?.bottom ?? 0,
    left: padding?.left ?? 0,
  };
}

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
      backgroundColor: props.theme.colors.surfaceMuted,
    };
  }

  measure(constraints: Constraints): Size {
    const padding = normalizePadding(this.layout.padding);
    const maxWidth = Number.isFinite(constraints.maxWidth)
      ? Math.max(0, constraints.maxWidth) - padding.left - padding.right
      : 80;
    const wrappedLines = wrapText(this.props.output, maxWidth);
    const height = 1 +
      1 + // empty line between header and output
      wrappedLines.length +
      padding.top +
      padding.bottom;
    let width = visibleWidth(this.props.command);
    for (const line of wrappedLines) {
      const w = visibleWidth(line);
      if (w > width) width = w;
    }
    return { width: width + padding.left + padding.right, height };
  }

  render(ctx: RenderContext): string[] {
    const width = ctx.contentRect.width;
    if (width <= 0) return [];

    const headerStyle = styleToAnsi({ fg: this.props.theme.colors.textMuted });
    const outputStyle = styleToAnsi({ fg: this.props.theme.colors.text });
    const lines: string[] = [];

    lines.push(`${headerStyle}${this.props.command}${RESET}`);
    lines.push('');

    const padding = normalizePadding(this.layout.padding);
    const innerWidth = width - padding.left - padding.right;
    const wrappedLines = wrapText(this.props.output, innerWidth);
    for (const line of wrappedLines) {
      lines.push(`${outputStyle}${line}${RESET}`);
    }

    return lines;
  }
}
