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
const CHIP = '\x1b[33m';

interface ChipRange {
  start: number;
  end: number;
}

export class MultilineEditor implements Component {
  private value = '';
  private cursor = 0;
  private readonly placeholder: string;
  private readonly maxRows: number;
  hiddenPrefix = '';
  chipColor?: () => string;
  mentionRanges?: (value: string, cursor: number) => ChipRange[];
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
        this.moveLeft();
        return;
      case 'right':
        this.moveRight();
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

  private chips(): ChipRange[] {
    return this.mentionRanges ? this.mentionRanges(this.value, this.cursor) : [];
  }

  private moveLeft(): void {
    const chip = this.chips().find((c) => c.start < this.cursor && this.cursor <= c.end);
    this.cursor = chip ? chip.start : Math.max(0, this.cursor - 1);
  }

  private moveRight(): void {
    const chip = this.chips().find((c) => c.start <= this.cursor && this.cursor < c.end);
    this.cursor = chip ? chip.end : Math.min(this.value.length, this.cursor + 1);
  }

  private backspace(): void {
    if (this.cursor === 0) return;
    const chip = this.chips().find((c) => c.start < this.cursor && this.cursor <= c.end);
    const from = chip ? chip.start : this.cursor - 1;
    const to = chip ? chip.end : this.cursor;
    this.value = this.value.slice(0, from) + this.value.slice(to);
    this.cursor = from;
    this.onChange?.(this.value);
  }

  private deleteForward(): void {
    if (this.cursor >= this.value.length) return;
    const chip = this.chips().find((c) => c.start <= this.cursor && this.cursor < c.end);
    const from = chip ? chip.start : this.cursor;
    const to = chip ? chip.end : this.cursor + 1;
    this.value = this.value.slice(0, from) + this.value.slice(to);
    this.cursor = from;
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

    const off = hidden ? 1 : 0;
    const chipColor = this.chipColor?.() || CHIP;
    const chips = this.chips()
      .map((c) => ({ start: c.start - off, end: c.end - off }))
      .filter((c) => c.end > 0);

    const lines = value.split('\n');
    const { row: cr, col: cc } = this.cursorRowCol(lines, cursorIdx);
    const height = Math.max(1, s.height);
    const top = cr >= height ? cr - height + 1 : 0;

    const lineStarts: number[] = [];
    let offset = 0;
    for (const line of lines) {
      lineStarts.push(offset);
      offset += line.length + 1;
    }

    for (let r = 0; r < height && top + r < lines.length; r++) {
      const idx = top + r;
      const line = lines[idx];
      const isCursorRow = idx === cr && s.focused;
      const hscroll = isCursorRow && cc >= width ? cc - width + 1 : 0;
      s.text(0, r, this.renderRow(line, lineStarts[idx], chips, chipColor, hscroll, width, isCursorRow ? cc : null));
    }
  }

  private renderRow(
    line: string,
    lineStart: number,
    chips: ChipRange[],
    chipColor: string,
    hscroll: number,
    width: number,
    cursorCol: number | null,
  ): string {
    const inChip = (abs: number) => chips.some((c) => abs >= c.start && abs < c.end);
    let out = '';
    let yellow = false;
    for (let c = hscroll; c < hscroll + width; c++) {
      const isCursor = cursorCol !== null && c === cursorCol;
      const hasChar = c < line.length;
      if (!hasChar && !isCursor) break;
      const ch = hasChar ? line[c] : ' ';
      if (isCursor) {
        if (yellow) {
          out += RESET;
          yellow = false;
        }
        out += `${CURSOR}${ch}${RESET}`;
        continue;
      }
      const wantYellow = hasChar && inChip(lineStart + c);
      if (wantYellow && !yellow) {
        out += chipColor;
        yellow = true;
      } else if (!wantYellow && yellow) {
        out += RESET;
        yellow = false;
      }
      out += ch;
    }
    if (yellow) out += RESET;
    return out;
  }
}
