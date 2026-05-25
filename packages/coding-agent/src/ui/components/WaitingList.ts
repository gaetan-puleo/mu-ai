import type { Component, LayoutStyle, RenderContext } from 'mu-tui';
import { truncateToWidth, visibleWidth } from 'mu-tui';
import { getTheme, styleToAnsi } from '../theme';

export type WaitingItemKind = 'command' | 'steering' | 'follow_up';

export interface WaitingItem {
  kind: WaitingItemKind;
  text: string;
}

export interface WaitingListProps {
  items: WaitingItem[];
  layout?: LayoutStyle;
}

const RESET = '\x1b[0m';

const KIND_LABEL: Record<WaitingItemKind, string> = {
  command: 'cmd',
  steering: 'steering',
  follow_up: 'follow-up',
};

export class WaitingList implements Component {
  layout: LayoutStyle;
  private items: WaitingItem[];

  constructor(props: WaitingListProps) {
    this.items = props.items;
    this.layout = { width: 'fill', height: Math.max(1, props.items.length), ...props.layout };
  }

  setItems(items: WaitingItem[]): void {
    this.items = items;
    this.layout.height = Math.max(1, items.length);
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const theme = getTheme(ctx);
    const muted = styleToAnsi(theme.styles.muted);
    const body = styleToAnsi(theme.styles.body);

    const lines: string[] = [];
    const count = Math.min(this.items.length, height);
    for (let i = 0; i < count; i++) {
      const item = this.items[i]!;
      const tag = `[${KIND_LABEL[item.kind]}]`;
      const tagStyled = muted ? `${muted}${tag}${RESET}` : tag;
      const tagWidth = visibleWidth(tag);
      const remaining = Math.max(0, width - tagWidth - 1);
      const text = remaining > 0
        ? (visibleWidth(item.text) > remaining ? truncateToWidth(item.text, remaining) : item.text)
        : '';
      const bodyStyled = body && text ? `${body}${text}${RESET}` : text;
      const line = text ? `${tagStyled} ${bodyStyled}` : tagStyled;
      lines.push(line);
    }
    return lines;
  }
}
