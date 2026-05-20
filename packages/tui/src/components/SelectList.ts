import type { InputEvent } from '../events';
import type { EventContext, LayoutStyle, RenderContext } from '../layout/types';
import type { Focusable } from '../types/component';
import { truncateToWidth, visibleWidth } from '../utils';

export interface SelectListItem<T = unknown> {
  label: string;
  value?: T;
  disabled?: boolean;
}

export interface SelectListProps<T = unknown> {
  items: SelectListItem<T>[];
  selectedIndex?: number;
  onSelect?: (item: SelectListItem<T>, index: number) => void;
  onChange?: (item: SelectListItem<T>, index: number) => void;
  layout?: LayoutStyle;
  selectedStyle?: string;
  disabledStyle?: string;
}

const DEFAULT_SELECTED_STYLE = '\x1b[7m';
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
  private readonly onSelect?: (item: SelectListItem<T>, index: number) => void;
  private readonly onChange?: (item: SelectListItem<T>, index: number) => void;
  private readonly selectedStyle: string;
  private readonly disabledStyle: string;
  private viewportTop = 0;

  constructor(props: SelectListProps<T>) {
    this._items = props.items;
    this._selectedIndex = clampIndex(props.selectedIndex ?? 0, this._items.length);
    this.onSelect = props.onSelect;
    this.onChange = props.onChange;
    this.selectedStyle = props.selectedStyle ?? DEFAULT_SELECTED_STYLE;
    this.disabledStyle = props.disabledStyle ?? DEFAULT_DISABLED_STYLE;
    this.layout = { focusable: true, ...props.layout };
  }

  get items(): SelectListItem<T>[] {
    return this._items;
  }

  setItems(items: SelectListItem<T>[]): void {
    this._items = items;
    this._selectedIndex = clampIndex(this._selectedIndex, items.length);
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

    this.adjustViewport(height);
    const lines: string[] = [];
    const end = Math.min(this._items.length, this.viewportTop + height);

    for (let i = this.viewportTop; i < end; i++) {
      const item = this._items[i];
      let line = visibleWidth(item.label) > width ? truncateToWidth(item.label, width) : item.label;
      const padding = width - visibleWidth(line);
      if (padding > 0) line += ' '.repeat(padding);

      if (i === this._selectedIndex && ctx.focused) {
        line = `${this.selectedStyle}${line}${RESET}`;
      } else if (item.disabled) {
        line = `${this.disabledStyle}${line}${RESET}`;
      }
      lines.push(line);
    }

    return lines;
  }

  handleEvent(event: InputEvent, _ctx: EventContext): void {
    if (event.type === 'mouse' && event.kind === 'press' && event.button === 'left') {
      const targetIndex = this.viewportTop + (_ctx.localY ?? 0);
      if (targetIndex >= 0 && targetIndex < this._items.length) {
        this.setSelectedIndex(targetIndex);
      }
      return;
    }
    if (event.type !== 'key' || event.kind === 'release') return;

    switch (event.key) {
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
    let next = this._selectedIndex;
    const len = this._items.length;
    for (let i = 0; i < len; i++) {
      next = (next + delta + len) % len;
      if (!this._items[next].disabled) break;
    }
    this.setSelectedIndex(next);
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
