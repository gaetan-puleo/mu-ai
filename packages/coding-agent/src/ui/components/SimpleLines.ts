import type { Component, InputEvent, LayoutStyle, RenderContext } from 'mu-tui';
import { truncateToWidth, visibleWidth } from 'mu-tui';
import { getTheme, styleToAnsi } from '../theme';

const RESET = '\x1b[0m';

function fit(text: string, width: number): string {
  return visibleWidth(text) > width ? truncateToWidth(text, width) : text;
}

function styledLine(text: string, sgr: string): string {
  return sgr ? `${sgr}${text}${RESET}` : text;
}

export class CommandLine implements Component {
  layout: LayoutStyle = { width: 'fill', height: 1, padding: { left: 1, right: 1 } };
  constructor(private readonly content: string) {}

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];
    return [styledLine(fit(this.content, width), styleToAnsi(getTheme(ctx).styles.muted))];
  }
}

export class CommandResultLine implements Component {
  layout: LayoutStyle = { width: 'fill', height: 1, padding: { left: 1, right: 1 }, margin: { bottom: 1 } };
  constructor(private readonly content: string) {}

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];
    return [styledLine(fit(this.content, width), styleToAnsi(getTheme(ctx).styles.muted))];
  }
}

export class ErrorLine implements Component {
  layout: LayoutStyle = { width: 'fill', height: 'auto' };
  constructor(private readonly content: string) {}

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];
    const theme = getTheme(ctx);
    const head = styledLine('! ', styleToAnsi(theme.styles.errorPrefix));
    const body = styledLine(this.content, styleToAnsi(theme.styles.errorLine));
    return [`${head}${body}`];
  }
}

export class ErrorToast implements Component {
  layout: LayoutStyle;
  constructor(private readonly content: string) {
    this.layout = { width: 'fill', height: 'auto', padding: { left: 1, right: 1, bottom: 1 }, zIndex: 20 };
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];
    const theme = getTheme(ctx);
    const maxTextWidth = Math.max(0, width - 4);
    const text = this.content.length > maxTextWidth
      ? `${this.content.slice(0, Math.max(0, maxTextWidth - 3))}...`
      : this.content;
    const prefix = styledLine('!', styleToAnsi(theme.styles.errorPrefix));
    const body = styledLine(text, styleToAnsi(theme.styles.errorLine));
    return [`${prefix} ${body}`.padEnd(width, ' ')];
  }
}

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
    return [styledLine(fit('[thinking]', width), styleToAnsi(getTheme(ctx).styles.reasoning))];
  }
}
