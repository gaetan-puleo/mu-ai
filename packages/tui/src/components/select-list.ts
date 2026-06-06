import type { InputEvent } from '../events';
import type { Component, Surface } from '../surface';
import { truncateToWidth, visibleWidth } from '../utils';

export interface SelectItem<T> {
  label: string;
  value: T;
}

const SELECTED = '\x1b[7m';
const RESET = '\x1b[0m';

const pad = (value: string, width: number): string => {
  const fitted = visibleWidth(value) > width ? truncateToWidth(value, width) : value;
  const gap = width - visibleWidth(fitted);
  return gap > 0 ? fitted + ' '.repeat(gap) : fitted;
};

export class SelectList<T> implements Component {
  private items: SelectItem<T>[];
  private selected = 0;
  private top = 0;
  private readonly maxRows: number;
  onSelect?: (item: SelectItem<T>) => void;

  constructor(items: SelectItem<T>[] = [], opts: { maxRows?: number } = {}) {
    this.items = items;
    this.maxRows = opts.maxRows ?? 10;
  }

  setItems(items: SelectItem<T>[]): void {
    this.items = items;
    if (this.selected >= items.length) this.selected = Math.max(0, items.length - 1);
  }

  selectedItem(): SelectItem<T> | undefined {
    return this.items[this.selected];
  }

  move(delta: number): void {
    if (this.items.length === 0) return;
    this.selected = (this.selected + delta + this.items.length) % this.items.length;
  }

  render(s: Surface): void {
    const rows = Math.min(this.items.length, this.maxRows, s.height === Infinity ? this.maxRows : s.height);
    if (this.selected < this.top) this.top = this.selected;
    else if (this.selected >= this.top + rows) this.top = this.selected - rows + 1;

    for (let i = 0; i < rows; i++) {
      const index = this.top + i;
      const item = this.items[index];
      if (!item) break;
      const line = pad(item.label, s.width);
      s.text(0, i, index === this.selected ? `${SELECTED}${line}${RESET}` : line);
    }
  }

  handleInput(event: InputEvent): boolean | void {
    if (event.type === 'mouse') {
      if (event.kind !== 'press' || event.button !== 'left') return false;
      const index = this.top + (event.localY ?? 0);
      if (index >= 0 && index < this.items.length) {
        this.selected = index;
        this.onSelect?.(this.items[index]);
      }
      return true;
    }
    if (event.type !== 'key' || event.kind === 'release') return;
    if (event.key === 'up') this.move(-1);
    else if (event.key === 'down') this.move(1);
    else if (event.key === 'enter') {
      const item = this.selectedItem();
      if (item) this.onSelect?.(item);
    }
  }
}

export const selectList = <T>(items?: SelectItem<T>[], opts?: { maxRows?: number }): SelectList<T> =>
  new SelectList(items ?? [], opts ?? {});
