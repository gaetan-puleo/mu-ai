import type { InputEvent } from '../events';
import type { EventContext, LayoutStyle, RenderContext } from '../layout/types';
import type { Focusable } from '../types/component';
import { sliceByColumn, visibleWidth } from '../utils';

export interface InputHighlight {
  start: number;
  end: number;
  style: string;
}

export interface InputProps {
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  layout?: LayoutStyle;
  /** Style applied to placeholder text when value is empty. */
  placeholderStyle?: string;
  /** Style applied to input text. */
  textStyle?: string;
  /** Style applied to the cursor cell when focused. Default reverse video. */
  cursorStyle?: string;
  /** Prefix kept in `value` but hidden when rendering. */
  hiddenPrefix?: string;
  /** Styled ranges within the input text (positions relative to value). */
  highlights?: InputHighlight[];
}

const DEFAULT_PLACEHOLDER_STYLE = '\x1b[2m';
const DEFAULT_CURSOR_STYLE = '\x1b[5;7m';

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
  placeholderStyle: string;
  textStyle: string;
  cursorStyle: string;
  hiddenPrefix: string;
  highlights: InputHighlight[];
  private scrollOffset = 0;

  constructor(props: InputProps = {}) {
    this._value = props.value ?? '';
    this._cursor = this._value.length;
    this.placeholder = props.placeholder ?? '';
    this.onChange = props.onChange;
    this.onSubmit = props.onSubmit;
    this.placeholderStyle = props.placeholderStyle ?? DEFAULT_PLACEHOLDER_STYLE;
    this.textStyle = props.textStyle ?? '';
    this.cursorStyle = props.cursorStyle ?? DEFAULT_CURSOR_STYLE;
    this.hiddenPrefix = props.hiddenPrefix ?? '';
    this.highlights = props.highlights ?? [];
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

  setCursor(cursor: number): void {
    this._cursor = Math.max(0, Math.min(cursor, this._value.length));
  }

  get cursor(): number {
    return this._cursor;
  }

  render(ctx: RenderContext): string[] {
    const width = ctx.contentRect.width;
    if (width <= 0) return [];

    const hiddenPrefixLength = this.hiddenPrefixLength();
    if (this._value.includes('\n')) return this.renderMultiline(ctx, hiddenPrefixLength);

    if (this._value.length === 0 && !ctx.focused && this.placeholder.length > 0) {
      const ph = this.placeholder.slice(0, width);
      return [`${this.placeholderStyle}${ph}\x1b[0m`];
    }

    const renderValue = this._value.slice(hiddenPrefixLength);
    const renderCursor = Math.max(0, this._cursor - hiddenPrefixLength);
    this.adjustScrollOffset(width, renderCursor);
    const visible = renderValue.slice(this.scrollOffset);
    const truncated = sliceByColumn(visible, 0, width, true);
    const truncatedWidth = visibleWidth(truncated);
    const padded = truncatedWidth < width ? truncated + ' '.repeat(width - truncatedWidth) : truncated;

    const baseOffset = hiddenPrefixLength + this.scrollOffset;

    if (!ctx.focused) return [this.applyHighlights(padded, baseOffset)];

    const cursorCol = renderCursor - this.scrollOffset;
    if (cursorCol < 0 || cursorCol >= width) return [this.applyHighlights(padded, baseOffset)];

    const before = sliceByColumn(padded, 0, cursorCol, true);
    const beforeWidth = visibleWidth(before);
    const beforePad = beforeWidth < cursorCol ? ' '.repeat(cursorCol - beforeWidth) : '';
    const cursorChar = sliceByColumn(padded, cursorCol, cursorCol + 1, true) || ' ';
    const after = sliceByColumn(padded, cursorCol + 1, width, true);
    const styledBefore = this.applyHighlights(`${before}${beforePad}`, baseOffset);
    const styledAfter = this.applyHighlights(after, baseOffset + cursorCol + 1);
    return [`${styledBefore}${this.cursorStyle}${cursorChar}\x1b[0m${styledAfter}`];
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
        if (event.shift) {
          this.insert('\n');
          return;
        }
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
      case 'up':
        this.moveCursorLine(-1);
        return;
      case 'down':
        this.moveCursorLine(1);
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

  private moveCursorLine(delta: -1 | 1): void {
    const lineStarts = this.lineStarts();
    const currentLine = this.lineIndexForCursor(lineStarts);
    const targetLine = currentLine + delta;
    if (targetLine < 0 || targetLine >= lineStarts.length) return;

    const currentColumn = this._cursor - lineStarts[currentLine];
    const targetStart = lineStarts[targetLine];
    const targetEnd = this.lineEnd(targetStart);
    this._cursor = Math.min(targetStart + currentColumn, targetEnd);
  }

  private adjustScrollOffset(width: number, cursor: number): void {
    if (cursor < this.scrollOffset) {
      this.scrollOffset = cursor;
    } else if (cursor >= this.scrollOffset + width) {
      this.scrollOffset = Math.max(0, cursor - width + 1);
    }
  }

  private renderMultiline(ctx: RenderContext, hiddenPrefixLength: number): string[] {
    const width = ctx.contentRect.width;
    const height = Math.max(1, ctx.contentRect.height);
    const renderValue = this._value.slice(hiddenPrefixLength);
    const renderCursor = Math.max(0, this._cursor - hiddenPrefixLength);
    const rawLines = renderValue.split('\n');
    const cursorLine = renderValue.slice(0, renderCursor).split('\n').length - 1;
    const cursorCol = renderCursor - renderValue.lastIndexOf('\n', renderCursor - 1) - 1;
    const firstLine = Math.max(0, cursorLine - height + 1);

    const lineOffsets: number[] = [0];
    for (let l = 1; l < rawLines.length; l++) {
      lineOffsets.push(lineOffsets[l - 1] + rawLines[l - 1].length + 1);
    }

    const lines = rawLines.slice(firstLine, firstLine + height).map((line, index) => {
      const truncated = sliceByColumn(line, 0, width, true);
      const truncatedWidth = visibleWidth(truncated);
      const padded = truncatedWidth < width ? truncated + ' '.repeat(width - truncatedWidth) : truncated;
      const lineIndex = firstLine + index;
      const valueOffset = hiddenPrefixLength + lineOffsets[lineIndex];

      if (!ctx.focused || lineIndex !== cursorLine) return this.applyHighlights(padded, valueOffset);

      const clampedCursorCol = Math.min(cursorCol, width - 1);
      const before = sliceByColumn(padded, 0, clampedCursorCol, true);
      const beforeWidth = visibleWidth(before);
      const beforePad = beforeWidth < clampedCursorCol ? ' '.repeat(clampedCursorCol - beforeWidth) : '';
      const cursorChar = sliceByColumn(padded, clampedCursorCol, clampedCursorCol + 1, true) || ' ';
      const after = sliceByColumn(padded, clampedCursorCol + 1, width, true);
      const styledBefore = this.applyHighlights(`${before}${beforePad}`, valueOffset);
      const styledAfter = this.applyHighlights(after, valueOffset + clampedCursorCol + 1);
      return `${styledBefore}${this.cursorStyle}${cursorChar}\x1b[0m${styledAfter}`;
    });

    while (lines.length < height) lines.push(this.styleText(' '.repeat(width)));
    return lines;
  }

  private styleText(text: string): string {
    return this.textStyle ? `${this.textStyle}${text}\x1b[0m` : text;
  }

  private applyHighlights(text: string, valueOffset: number): string {
    if (this.highlights.length === 0 || text.length === 0) {
      return this.textStyle ? `${this.textStyle}${text}\x1b[0m` : text;
    }

    let result = '';
    let i = 0;
    while (i < text.length) {
      const pos = valueOffset + i;
      const hl = this.highlights.find(h => pos >= h.start && pos < h.end);
      if (hl) {
        const segEnd = Math.min(text.length, hl.end - valueOffset);
        const segment = text.slice(i, segEnd);
        result += `${hl.style}${segment}\x1b[0m`;
        i = segEnd;
      } else {
        let nextStart = text.length;
        for (const h of this.highlights) {
          const rel = h.start - valueOffset;
          if (rel > i && rel < nextStart) nextStart = rel;
        }
        const segment = text.slice(i, nextStart);
        result += this.textStyle ? `${this.textStyle}${segment}\x1b[0m` : segment;
        i = nextStart;
      }
    }
    return result;
  }

  private hiddenPrefixLength(): number {
    return this.hiddenPrefix && this._value.startsWith(this.hiddenPrefix) ? this.hiddenPrefix.length : 0;
  }

  private lineStarts(): number[] {
    const starts = [0];
    for (let i = 0; i < this._value.length; i++) {
      if (this._value.startsWith('\n', i)) starts.push(i + 1);
    }
    return starts;
  }

  private lineIndexForCursor(lineStarts: number[]): number {
    let line = 0;
    for (let i = 1; i < lineStarts.length; i++) {
      if (lineStarts[i] > this._cursor) break;
      line = i;
    }
    return line;
  }

  private lineEnd(lineStart: number): number {
    const newline = this._value.indexOf('\n', lineStart);
    return newline === -1 ? this._value.length : newline;
  }
}
