import type { InputEvent } from '../events';
import type { EventContext, LayoutStyle, RenderContext } from '../layout/types';
import type { Focusable } from '../types/component';
import { truncateToWidth, visibleWidth } from '../utils';

export interface SelectListItem<T = unknown> {
  label: string;
  selectedLabel?: string;
  value?: T;
  disabled?: boolean;
}

export interface SelectListStyles {
  item?: string;
  selected?: string;
  hovered?: string;
  disabled?: string;
}

export interface SelectListProps<T = unknown> {
  items: SelectListItem<T>[];
  selectedIndex?: number;
  onSelect?: (item: SelectListItem<T>, index: number) => void;
  onChange?: (item: SelectListItem<T>, index: number) => void;
  layout?: LayoutStyle;
  itemStyle?: string;
  selectedStyle?: string;
  hoveredStyle?: string;
  disabledStyle?: string;
  /**
   * Optional per-render style resolver. When provided, returned styles override
   * the static `selectedStyle` / `hoveredStyle` / `disabledStyle` props for that
   * frame. This lets a consumer pull SGR strings from a theme stored in
   * `RenderContext.userContext` without coupling `mu-tui` to any theme system.
   */
  resolveStyles?: (ctx: RenderContext) => SelectListStyles | undefined;
  /**
   * Horizontal padding (in cells) inside each item row. The background
   * highlight still spans the full row width — only the text is inset.
   * Default 0.
   */
  itemPaddingX?: number;
}

// Default highlight palette. Precomputed from a canonical dark theme so that a
// `SelectList` rendered without a `resolveStyles` callback still has reasonable
// defaults. Consumers wanting theme-reactive colors should pass `resolveStyles`.
//
//   item:     fg neutral[100] (#f4f4f5) on bg neutral[900] (#18181b)
//   selected: fg neutral[0]   (#ffffff) on bg neutral[700] (#3f3f46)
//   hovered:  fg neutral[100] (#f4f4f5) on bg neutral[800] (#27272a)
//   disabled: dim
const DEFAULT_ITEM_STYLE = '\x1b[38;2;244;244;245m\x1b[48;2;24;24;27m';
const DEFAULT_SELECTED_STYLE = '\x1b[38;2;255;255;255m\x1b[48;2;63;63;70m';
const DEFAULT_HOVERED_STYLE = '\x1b[38;2;244;244;245m\x1b[48;2;39;39;42m';
const DEFAULT_DISABLED_STYLE = '\x1b[2m';
const RESET = '\x1b[0m';

/**
 * Vertical selection list. Arrow keys move the highlight; Enter commits.
 *
 * The visible window scrolls to keep the highlighted item in view. The list
 * occupies its `contentRect`; items beyond the viewport are clipped.
 */
export class SelectList<T = unknown> implements Focusable {
  layout: LayoutStyle;
  focused = false;
  private _items: SelectListItem<T>[];
  private _selectedIndex: number;
  private _hoveredIndex = -1;
  private readonly onSelect?: (item: SelectListItem<T>, index: number) => void;
  private readonly onChange?: (item: SelectListItem<T>, index: number) => void;
  private readonly itemStyle: string;
  private readonly selectedStyle: string;
  private readonly hoveredStyle: string;
  private readonly disabledStyle: string;
  private readonly resolveStyles?: (ctx: RenderContext) => SelectListStyles | undefined;
  private readonly itemPaddingX: number;
  private viewportTop = 0;

  constructor(props: SelectListProps<T>) {
    this._items = props.items;
    this._selectedIndex = clampIndex(props.selectedIndex ?? 0, this._items.length);
    this.onSelect = props.onSelect;
    this.onChange = props.onChange;
    this.itemStyle = props.itemStyle ?? DEFAULT_ITEM_STYLE;
    this.selectedStyle = props.selectedStyle ?? DEFAULT_SELECTED_STYLE;
    this.hoveredStyle = props.hoveredStyle ?? DEFAULT_HOVERED_STYLE;
    this.disabledStyle = props.disabledStyle ?? DEFAULT_DISABLED_STYLE;
    this.resolveStyles = props.resolveStyles;
    this.itemPaddingX = Math.max(0, props.itemPaddingX ?? 0);
    this.layout = { focusable: true, ...props.layout };
  }

  get items(): SelectListItem<T>[] {
    return this._items;
  }

  setItems(items: SelectListItem<T>[]): void {
    this._items = items;
    this._selectedIndex = clampIndex(this._selectedIndex, items.length);
    if (this._hoveredIndex >= items.length) this._hoveredIndex = -1;
  }

  get selectedIndex(): number {
    return this._selectedIndex;
  }

  setSelectedIndex(index: number): void {
    const next = clampIndex(index, this._items.length);
    if (next === this._selectedIndex) return;
    this._selectedIndex = next;
    const item = this._items[next];
    if (item) this.onChange?.(item, next);
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0 || this._items.length === 0) return [];

    const resolved = this.resolveStyles?.(ctx);
    const itemStyle = resolved?.item ?? this.itemStyle;
    const selectedStyle = resolved?.selected ?? this.selectedStyle;
    const hoveredStyle = resolved?.hovered ?? this.hoveredStyle;
    const disabledStyle = resolved?.disabled ?? this.disabledStyle;

    this.adjustViewport(height);
    const lines: string[] = [];
    const end = Math.min(this._items.length, this.viewportTop + height);
    const padX = Math.min(this.itemPaddingX, Math.floor(width / 2));
    const innerWidth = Math.max(0, width - 2 * padX);
    const sidePad = padX > 0 ? ' '.repeat(padX) : '';

    for (let i = this.viewportTop; i < end; i++) {
      const item = this._items[i];
      const isSelected = i === this._selectedIndex && ctx.focused;
      const text = (isSelected && item.selectedLabel) ? item.selectedLabel : item.label;
      let inner = visibleWidth(text) > innerWidth ? truncateToWidth(text, innerWidth) : text;
      const fill = innerWidth - visibleWidth(inner);
      if (fill > 0) inner += ' '.repeat(fill);
      let line = `${sidePad}${inner}${sidePad}`;

      if (isSelected) {
        line = `${selectedStyle}${line}${RESET}`;
      } else if (i === this._hoveredIndex) {
        line = `${hoveredStyle}${line}${RESET}`;
      } else if (item.disabled) {
        line = `${disabledStyle}${line}${RESET}`;
      } else if (itemStyle) {
        line = `${itemStyle}${line}${RESET}`;
      }
      lines.push(line);
    }

    return lines;
  }

  handleEvent(event: InputEvent, ctx: EventContext): void {
    if (event.type === 'mouse') {
      this.handleMouseEvent(event, ctx);
      return;
    }
    if (event.type !== 'key' || event.kind === 'release') return;
    this.handleKeyEvent(event.key);
  }

  private handleMouseEvent(event: Extract<InputEvent, { type: 'mouse' }>, ctx: EventContext): void {
    const localY = ctx.localY ?? 0;
    const targetIndex = this.viewportTop + localY;
    const inRange = targetIndex >= 0 && targetIndex < this._items.length;

    if (!inRange) {
      if (event.kind === 'move') this._hoveredIndex = -1;
      return;
    }

    if (event.kind === 'move' || event.kind === 'drag') {
      this._hoveredIndex = targetIndex;
      return;
    }

    if (event.kind === 'press' && event.button === 'left') {
      this.setSelectedIndex(targetIndex);
      this._hoveredIndex = targetIndex;
      const item = this._items[targetIndex];
      if (item && !item.disabled) this.onSelect?.(item, targetIndex);
    }
  }

  private handleKeyEvent(key: string): void {
    switch (key) {
      case 'up':
        this.moveSelection(-1);
        return;
      case 'down':
        this.moveSelection(1);
        return;
      case 'home':
        this.setSelectedIndex(0);
        return;
      case 'end':
        this.setSelectedIndex(this._items.length - 1);
        return;
      case 'enter': {
        const item = this._items[this._selectedIndex];
        if (item && !item.disabled) this.onSelect?.(item, this._selectedIndex);
      }
    }
  }

  private moveSelection(delta: number): void {
    if (this._items.length === 0) return;
    const len = this._items.length;
    let next = this._selectedIndex;
    for (let i = 0; i < len; i++) {
      next = (next + delta + len) % len;
      if (!this._items[next].disabled) {
        this.setSelectedIndex(next);
        return;
      }
    }
  }

  private adjustViewport(height: number): void {
    if (this._selectedIndex < this.viewportTop) {
      this.viewportTop = this._selectedIndex;
    } else if (this._selectedIndex >= this.viewportTop + height) {
      this.viewportTop = this._selectedIndex - height + 1;
    }
    if (this.viewportTop < 0) this.viewportTop = 0;
  }
}

function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}
