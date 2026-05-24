import type { Component, EventContext, InputEvent, LayoutStyle, RenderContext } from 'mu-tui';
import { truncateToWidth, visibleWidth } from 'mu-tui';
import { getTheme, styleToAnsi } from '../theme';

export interface CommandPaletteItem {
  name: string;
  description: string;
}

export interface CommandPaletteProps {
  items: CommandPaletteItem[];
  selectedIndex?: number;
  onSelect?: (index: number) => void;
  layout?: LayoutStyle;
}

const RESET = '\x1b[0m';
const DESCRIPTION = '\x1b[2m';

export class CommandPalette implements Component {
  layout: LayoutStyle;
  private items: CommandPaletteItem[];
  private selectedIndex: number;
  private hoveredIndex = -1;
  private readonly onSelect?: (index: number) => void;

  constructor(props: CommandPaletteProps) {
    this.items = props.items;
    this.selectedIndex = props.selectedIndex ?? 0;
    this.onSelect = props.onSelect;
    this.layout = { width: 'fill', height: Math.max(1, props.items.length), ...props.layout };
  }

  setItems(items: CommandPaletteItem[]): void {
    this.items = items;
    this.layout.height = Math.max(1, items.length);
    if (this.selectedIndex >= items.length) this.selectedIndex = Math.max(0, items.length - 1);
    this.hoveredIndex = -1;
  }

  setSelectedIndex(index: number): void {
    this.selectedIndex = Math.max(0, Math.min(index, Math.max(0, this.items.length - 1)));
  }

  handleEvent(event: InputEvent, ctx: EventContext): void {
    if (event.type !== 'mouse') return;
    const y = ctx.localY ?? 0;
    if (y < 0 || y >= this.items.length) {
      if (event.kind === 'move') this.hoveredIndex = -1;
      return;
    }

    if (event.kind === 'move' || event.kind === 'drag') {
      this.hoveredIndex = y;
      return;
    }
    if (event.kind === 'press' && event.button === 'left') {
      this.selectedIndex = y;
      this.hoveredIndex = y;
      this.onSelect?.(y);
    }
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const theme = getTheme(ctx);
    const selectedSgr = styleToAnsi(theme.styles.commandPaletteSelected);
    const hoverSgr = styleToAnsi(theme.styles.commandPaletteHover);
    const normalSgr = styleToAnsi(theme.styles.commandPaletteItem);

    const visible = this.items.slice(0, height);
    const maxNameWidth = visible.reduce((max, item) => Math.max(max, item.name.length + 1), 0);
    const descWidth = Math.max(0, width - 2 - maxNameWidth);

    return visible.map((item, index) => {
      const selected = index === this.selectedIndex;
      const hovered = index === this.hoveredIndex;
      const prefix = selected ? '› ' : '  ';
      const command = `/${item.name}`;
      const namePad = ' '.repeat(Math.max(0, maxNameWidth - command.length));
      const descText = item.description ? `  ${item.description}` : '';
      const fittedDesc = fit(descText, descWidth);
      const descStyle = selected ? '' : DESCRIPTION;
      const line = `${prefix}${command}${namePad}${descStyle}${fittedDesc}${descStyle ? RESET : ''}`;
      const style = selected ? selectedSgr : hovered ? hoverSgr : normalSgr;
      return style ? `${style}${line}${RESET}` : line;
    });
  }
}

function fit(value: string, width: number): string {
  const truncated = visibleWidth(value) > width ? truncateToWidth(value, width) : value;
  const padding = width - visibleWidth(truncated);
  return padding > 0 ? truncated + ' '.repeat(padding) : truncated;
}
