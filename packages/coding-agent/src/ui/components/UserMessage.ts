import type { Component, Constraints, LayoutStyle, RenderContext, Size } from 'mu-tui';
import { truncateToWidth, visibleWidth, wrapText } from 'mu-tui';
import { Box } from 'mu-tui/components';
import { getTheme, styleToAnsi, type Theme } from '../theme';

export interface UserMessageProps {
  content: string;
  label?: string;
  /**
   * Theme captured at construction time. The surface color is baked into the
   * outer Box so the layout engine paints padding cells correctly. Text
   * styling still reads the active theme at render time, so live switches
   * recolor text within the same bubble.
   */
  theme: Theme;
}

const RESET = '\x1b[0m';

class UserMessageLabel implements Component {
  layout: LayoutStyle;

  constructor(private readonly label: string) {
    this.layout = { width: 'fill', height: 1 };
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const theme = getTheme(ctx);
    const prefix = styleToAnsi(theme.styles.muted);
    const text = `[${this.label}]`;
    const fitted = visibleWidth(text) > width ? truncateToWidth(text, width) : text;
    return [prefix ? `${prefix}${fitted}${RESET}` : fitted];
  }
}

class UserMessageBody implements Component {
  layout: LayoutStyle;
  private content: string;

  constructor(content: string) {
    this.content = content;
    this.layout = { width: 'fill', height: 'auto' };
  }

  setContent(content: string): void {
    this.content = content;
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const theme = getTheme(ctx);
    const prefix = styleToAnsi(theme.styles.userMessage);

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

export class UserMessage extends Box {
  constructor(props: UserMessageProps) {
    const children: Component[] = [];
    if (props.label) children.push(new UserMessageLabel(props.label));
    children.push(new UserMessageBody(props.content));

    super({
      layout: {
        width: 'fill',
        height: 'auto',
        margin: { bottom: 1 },
        padding: { top: 1, right: 1, bottom: 1, left: 1 },
        backgroundColor: props.theme.colors.surfaceMuted,
      },
      children,
    });
  }
}
