import type { Component, InputEvent, KeyInputEvent, Surface } from 'mu-tui';
import { truncateToWidth, visibleWidth } from 'mu-tui';

export interface MultilineEditorOptions {
  placeholder?: string;
  maxRows?: number;
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;
}

const CURSOR = '\x1b[7m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

export class MultilineEditor implements Component {
  private value = '';
  private cursor = 0;
  private readonly placeholder: string;
  private readonly maxRows: number;
  hiddenPrefix = '';
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;

  constructor(opts: MultilineEditorOptions = {}) {
    this.placeholder = opts.placeholder ?? '';
    this.maxRows = opts.maxRows ?? 7;
    this.onSubmit = opts.onSubmit;
    this.onChange = opts.onChange;
  }

  getValue(): string {
    return this.value;
  }

  setValue(value: string): void {
    this.value = value;
    if (this.cursor > value.length) this.cursor = value.length;
    this.onChange?.(value);
  }

  get cursorPos(): number {
    return this.cursor;
  }

  setCursor(n: number): void {
    this.cursor = Math.max(0, Math.min(n, this.value.length));
  }

  rows(): number {
    return Math.min(this.maxRows, Math.max(1, this.value.split('\n').length));
  }

  handleInput(event: InputEvent): void {
    if (event.type === 'paste') {
      this.insert(event.text);
      return;
    }
    if (event.type === 'text') {
      this.insert(event.text);
      return;
    }
    if (event.type !== 'key' || event.kind === 'release') return;
    this.handleKey(event);
  }

  private handleKey(event: KeyInputEvent): void {
    switch (event.key) {
      case 'enter':
        if (event.ctrl || event.shift) this.insert('\n');
        else this.onSubmit?.(this.value);
        return;
      case 'backspace':
        this.backspace();
        return;
      case 'delete':
        this.deleteForward();
        return;
      case 'left':
        this.cursor = Math.max(0, this.cursor - 1);
        return;
      case 'right':
        this.cursor = Math.min(this.value.length, this.cursor + 1);
        return;
      case 'home':
        this.cursor = this.lineStart();
        return;
      case 'end':
        this.cursor = this.lineEnd();
        return;
      default:
        if (event.text && !event.ctrl && !event.meta && !event.alt) this.insert(event.text);
    }
  }

  private lineStart(): number {
    return this.value.lastIndexOf('\n', this.cursor - 1) + 1;
  }

  private lineEnd(): number {
    const next = this.value.indexOf('\n', this.cursor);
    return next === -1 ? this.value.length : next;
  }

  private insert(text: string): void {
    this.value = this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor);
    this.cursor += text.length;
    this.onChange?.(this.value);
  }

  private backspace(): void {
    if (this.cursor === 0) return;
    this.value = this.value.slice(0, this.cursor - 1) + this.value.slice(this.cursor);
    this.cursor -= 1;
    this.onChange?.(this.value);
  }

  private deleteForward(): void {
    if (this.cursor >= this.value.length) return;
    this.value = this.value.slice(0, this.cursor) + this.value.slice(this.cursor + 1);
    this.onChange?.(this.value);
  }

  private cursorRowCol(lines: string[], cursor: number): { row: number; col: number } {
    let remaining = cursor;
    for (let i = 0; i < lines.length; i++) {
      if (remaining <= lines[i].length) return { row: i, col: remaining };
      remaining -= lines[i].length + 1;
    }
    return { row: lines.length - 1, col: lines[lines.length - 1]?.length ?? 0 };
  }

  render(s: Surface): void {
    const width = s.width;
    if (width <= 0) return;

    const hidden = this.hiddenPrefix !== '' && this.value.startsWith(this.hiddenPrefix);
    const value = hidden ? this.value.slice(1) : this.value;
    const cursorIdx = hidden ? Math.max(0, this.cursor - 1) : this.cursor;

    if (value.length === 0 && this.placeholder && !s.focused) {
      const ph = visibleWidth(this.placeholder) > width ? truncateToWidth(this.placeholder, width) : this.placeholder;
      s.text(0, 0, `${DIM}${ph}${RESET}`);
      return;
    }

    const lines = value.split('\n');
    const { row: cr, col: cc } = this.cursorRowCol(lines, cursorIdx);
    const height = Math.max(1, s.height);
    const top = cr >= height ? cr - height + 1 : 0;

    for (let r = 0; r < height && top + r < lines.length; r++) {
      const line = lines[top + r];
      if (top + r === cr && s.focused) {
        const hscroll = cc >= width ? cc - width + 1 : 0;
        const visible = line.slice(hscroll, hscroll + width);
        const col = cc - hscroll;
        const before = visible.slice(0, col);
        const at = visible.slice(col, col + 1) || ' ';
        const after = visible.slice(col + 1);
        s.text(0, r, `${before}${CURSOR}${at}${RESET}${after}`);
      } else {
        s.text(0, r, line.length > width ? line.slice(0, width) : line);
      }
    }
  }
}
