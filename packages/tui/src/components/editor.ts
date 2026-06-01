import type { InputEvent, KeyInputEvent } from '../events';
import type { Component, Surface } from '../surface';
import { sliceByColumn } from '../utils';

export interface EditorOptions {
  value?: string;
  placeholder?: string;
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;
}

const CURSOR = '\x1b[7m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

export class Editor implements Component {
  private value: string;
  private cursor: number;
  private scroll = 0;
  private readonly placeholder: string;
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;

  constructor(opts: EditorOptions = {}) {
    this.value = opts.value ?? '';
    this.cursor = this.value.length;
    this.placeholder = opts.placeholder ?? '';
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

  render(s: Surface): void {
    const width = s.width;
    if (width <= 0) return;

    if (this.value.length === 0 && this.placeholder && !s.focused) {
      s.text(0, 0, `${DIM}${sliceByColumn(this.placeholder, 0, width, true)}${RESET}`);
      return;
    }

    if (this.cursor < this.scroll) this.scroll = this.cursor;
    else if (this.cursor >= this.scroll + width) this.scroll = this.cursor - width + 1;

    const visible = this.value.slice(this.scroll, this.scroll + width);
    if (!s.focused) {
      s.text(0, 0, visible);
      return;
    }

    const col = this.cursor - this.scroll;
    const before = visible.slice(0, col);
    const at = visible.slice(col, col + 1) || ' ';
    const after = visible.slice(col + 1);
    s.text(0, 0, `${before}${CURSOR}${at}${RESET}${after}`);
  }

  handleInput(event: InputEvent): void {
    if (event.type === 'paste') {
      this.insert(event.text.replace(/\n/g, ' '));
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
        this.onSubmit?.(this.value);
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
        this.cursor = 0;
        return;
      case 'end':
        this.cursor = this.value.length;
        return;
      default:
        if (event.text && !event.ctrl && !event.meta && !event.alt) this.insert(event.text);
    }
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
}

export const editor = (opts?: EditorOptions): Editor => new Editor(opts);
