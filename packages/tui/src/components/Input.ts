import type { InputEvent } from '../events';
import type { EventContext, LayoutStyle, RenderContext } from '../layout/types';
import type { Focusable } from '../types/component';
import { sliceByColumn, visibleWidth } from '../utils';

export interface InputProps {
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  layout?: LayoutStyle;
  /** Style applied to placeholder text when value is empty. */
  placeholderStyle?: string;
  /** Style applied to the cursor cell when focused. Default reverse video. */
  cursorStyle?: string;
}

const DEFAULT_PLACEHOLDER_STYLE = '\x1b[2m';
const DEFAULT_CURSOR_STYLE = '\x1b[7m';

/**
 * Single-line text input.
 *
 * - Tracks `value` and `cursor` position (in characters, not visible columns).
 * - Renders a horizontally scrolling view that keeps the cursor in frame.
 * - Handles: text insert, backspace, delete, arrows, Home / End, Enter (submit).
 */
export class Input implements Focusable {
  layout: LayoutStyle;
  focused = false;
  private _value: string;
  private _cursor: number;
  private readonly placeholder: string;
  private readonly onChange?: (value: string) => void;
  private readonly onSubmit?: (value: string) => void;
  private readonly placeholderStyle: string;
  private readonly cursorStyle: string;
  private scrollOffset = 0;

  constructor(props: InputProps = {}) {
    this._value = props.value ?? '';
    this._cursor = this._value.length;
    this.placeholder = props.placeholder ?? '';
    this.onChange = props.onChange;
    this.onSubmit = props.onSubmit;
    this.placeholderStyle = props.placeholderStyle ?? DEFAULT_PLACEHOLDER_STYLE;
    this.cursorStyle = props.cursorStyle ?? DEFAULT_CURSOR_STYLE;
    this.layout = { height: 1, focusable: true, ...props.layout };
  }

  get value(): string {
    return this._value;
  }

  setValue(value: string): void {
    this._value = value;
    if (this._cursor > value.length) this._cursor = value.length;
    this.onChange?.(value);
  }

  get cursor(): number {
    return this._cursor;
  }

  render(ctx: RenderContext): string[] {
    const width = ctx.contentRect.width;
    if (width <= 0) return [];

    if (this._value.length === 0 && !ctx.focused && this.placeholder.length > 0) {
      const ph = this.placeholder.slice(0, width);
      return [`${this.placeholderStyle}${ph}\x1b[0m`];
    }

    this.adjustScrollOffset(width);
    const visible = this._value.slice(this.scrollOffset);
    const truncated = sliceByColumn(visible, 0, width, true);
    const truncatedWidth = visibleWidth(truncated);
    const padded = truncatedWidth < width ? truncated + ' '.repeat(width - truncatedWidth) : truncated;

    if (!ctx.focused) return [padded];

    const cursorCol = this._cursor - this.scrollOffset;
    if (cursorCol < 0 || cursorCol >= width) return [padded];

    const before = sliceByColumn(padded, 0, cursorCol, true);
    const beforeWidth = visibleWidth(before);
    const beforePad = beforeWidth < cursorCol ? ' '.repeat(cursorCol - beforeWidth) : '';
    const cursorChar = sliceByColumn(padded, cursorCol, cursorCol + 1, true) || ' ';
    const after = sliceByColumn(padded, cursorCol + 1, width, true);
    return [`${before}${beforePad}${this.cursorStyle}${cursorChar}\x1b[0m${after}`];
  }

  handleEvent(event: InputEvent, _ctx: EventContext): void {
    if (event.type === 'text') {
      this.insert(event.text);
      return;
    }
    if (event.type === 'paste') {
      this.insert(event.text.replace(/\n/g, ' '));
      return;
    }
    if (event.type !== 'key') return;
    if (event.kind === 'release') return;

    switch (event.key) {
      case 'enter':
        this.onSubmit?.(this._value);
        return;
      case 'backspace':
        this.backspace();
        return;
      case 'delete':
        this.delete();
        return;
      case 'left':
        this.moveCursor(-1);
        return;
      case 'right':
        this.moveCursor(1);
        return;
      case 'home':
        this._cursor = 0;
        return;
      case 'end':
        this._cursor = this._value.length;
        return;
      default:
        if (event.text && !event.ctrl && !event.meta && !event.alt) {
          this.insert(event.text);
        }
    }
  }

  private insert(text: string): void {
    const next = this._value.slice(0, this._cursor) + text + this._value.slice(this._cursor);
    this._value = next;
    this._cursor += text.length;
    this.onChange?.(next);
  }

  private backspace(): void {
    if (this._cursor === 0) return;
    this._value = this._value.slice(0, this._cursor - 1) + this._value.slice(this._cursor);
    this._cursor -= 1;
    this.onChange?.(this._value);
  }

  private delete(): void {
    if (this._cursor >= this._value.length) return;
    this._value = this._value.slice(0, this._cursor) + this._value.slice(this._cursor + 1);
    this.onChange?.(this._value);
  }

  private moveCursor(delta: number): void {
    const next = this._cursor + delta;
    if (next < 0) this._cursor = 0;
    else if (next > this._value.length) this._cursor = this._value.length;
    else this._cursor = next;
  }

  private adjustScrollOffset(width: number): void {
    if (this._cursor < this.scrollOffset) {
      this.scrollOffset = this._cursor;
    } else if (this._cursor >= this.scrollOffset + width) {
      this.scrollOffset = Math.max(0, this._cursor - width + 1);
    }
  }
}
