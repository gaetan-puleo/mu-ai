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

export interface OutputBlockProps {
  command: string;
  output: string;
  variant?: 'default' | 'error';
  theme: Theme;
}

const MAX_COLLAPSED_LINES = 8;

export class OutputBlock implements Component {
  layout: LayoutStyle;
  expanded = false;

  constructor(private readonly props: OutputBlockProps) {
    const isError = props.variant === 'error';
    this.layout = {
      width: 'fill',
      height: 'auto',
      margin: { bottom: 1 },
      padding: { top: 1, right: 1, bottom: 1, left: 1 },
      backgroundColor: isError ? props.theme.colors.surfaceMuted : props.theme.colors.surface,
    };
  }

  private visibleLines(maxWidth: number): { lines: string[]; truncated: number } {
    const all = wrapText(this.props.output, maxWidth);
    if (this.expanded || all.length <= MAX_COLLAPSED_LINES) {
      return { lines: all, truncated: 0 };
    }
    return { lines: all.slice(0, MAX_COLLAPSED_LINES), truncated: all.length - MAX_COLLAPSED_LINES };
  }

  measure(constraints: Constraints): Size {
    const padding = normalizePadding(this.layout.padding);
    const maxWidth = Number.isFinite(constraints.maxWidth)
      ? Math.max(0, constraints.maxWidth) - padding.left - padding.right
      : 80;
    const { lines, truncated } = this.visibleLines(maxWidth);
    const height = 1 + 1 + lines.length + (truncated > 0 ? 1 : 0) + padding.top + padding.bottom;
    let width = visibleWidth(this.props.command);
    for (const line of lines) {
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
    const result: string[] = [];

    result.push(`${headerStyle}${this.props.command}${RESET}`);
    result.push('');

    const { lines, truncated } = this.visibleLines(width);
    for (const line of lines) {
      result.push(`${outputStyle}${line}${RESET}`);
    }
    if (truncated > 0) {
      result.push(`${headerStyle}... ${truncated} more lines (ctrl+o)${RESET}`);
    }

    return result;
  }
}
