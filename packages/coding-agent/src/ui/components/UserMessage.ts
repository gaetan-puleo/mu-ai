import type { Component, Constraints, LayoutStyle, RenderContext, Size } from 'mu-tui';
import { truncateToWidth, visibleWidth, wrapText } from 'mu-tui';
import { Box } from 'mu-tui/components';
import { darkTheme, getTheme, styleToAnsi } from '../theme';

export interface UserMessageProps {
  content: string;
  label?: string;
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

class UserMessagePrompt implements Component {
  layout: LayoutStyle = { width: 2, height: 1 };

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];
    const theme = getTheme(ctx);
    const prefix = styleToAnsi(theme.styles.muted);
    return [prefix ? `${prefix}❯${RESET}` : '❯'];
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
    const body = new UserMessageBody(props.content);
    const contentRow = new Box({
      layout: { width: 'fill', height: 'auto', direction: 'row' },
      children: [new UserMessagePrompt(), body],
    });

    const children: Component[] = [];
    if (props.label) children.push(new UserMessageLabel(props.label));
    children.push(contentRow);

    super({
      layout: {
        width: 'fill',
        height: 'auto',
        margin: { bottom: 1 },
        padding: { right: 1, left: 1 },
        backgroundColor: darkTheme.styles.userMessage.bg,
      },
      children,
    });
  }

  override render(ctx?: RenderContext): string[] {
    if (ctx && this.layout) this.layout.backgroundColor = getTheme(ctx).styles.userMessage.bg;
    return super.render();
  }
}
