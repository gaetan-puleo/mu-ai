import type { Constraints, LayoutStyle, RenderContext, Size } from '../layout/types';
import type { Component } from '../types/component';
import { truncateToWidth, visibleWidth } from '../utils';

export type DiffMode = 'inline' | 'side-by-side';

export interface DiffProps {
  before: string;
  after: string;
  mode?: DiffMode;
  showLineNumbers?: boolean;
  /** Number of unchanged lines to show around changes. Defaults to all lines. */
  contextLines?: number;
  layout?: LayoutStyle;
  addedStyle?: string;
  removedStyle?: string;
  unchangedStyle?: string;
}

type DiffPart =
  | { type: 'equal'; beforeLine: number; afterLine: number; text: string }
  | { type: 'delete'; beforeLine: number; text: string }
  | { type: 'insert'; afterLine: number; text: string };

type DiffRow =
  | { type: 'equal'; beforeLine: number; afterLine: number; beforeText: string; afterText: string }
  | { type: 'delete'; beforeLine: number; beforeText: string }
  | { type: 'insert'; afterLine: number; afterText: string }
  | { type: 'replace'; beforeLine: number; afterLine: number; beforeText: string; afterText: string }
  | { type: 'gap' };

const RESET = '\x1b[0m';
const DEFAULT_ADDED_STYLE = '\x1b[32m';
const DEFAULT_REMOVED_STYLE = '\x1b[31m';
const DEFAULT_UNCHANGED_STYLE = '\x1b[2m';

export class Diff implements Component {
  layout?: LayoutStyle;
  private before: string;
  private after: string;
  private mode: DiffMode;
  private showLineNumbers: boolean;
  private contextLines?: number;
  private addedStyle: string;
  private removedStyle: string;
  private unchangedStyle: string;

  constructor(props: DiffProps) {
    this.before = props.before;
    this.after = props.after;
    this.mode = props.mode ?? 'inline';
    this.showLineNumbers = props.showLineNumbers ?? true;
    this.contextLines = props.contextLines;
    this.layout = props.layout;
    this.addedStyle = props.addedStyle ?? DEFAULT_ADDED_STYLE;
    this.removedStyle = props.removedStyle ?? DEFAULT_REMOVED_STYLE;
    this.unchangedStyle = props.unchangedStyle ?? DEFAULT_UNCHANGED_STYLE;
  }

  setBefore(value: string): void {
    this.before = value;
  }

  setAfter(value: string): void {
    this.after = value;
  }

  setMode(mode: DiffMode): void {
    this.mode = mode;
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const rows = this.rows();
    const lines = this.mode === 'side-by-side' ? this.renderSideBySide(rows, width) : this.renderInline(rows, width);
    return lines.slice(0, height);
  }

  measure(constraints: Constraints): Size {
    const rows = this.rows();
    const maxWidth = Number.isFinite(constraints.maxWidth)
      ? Math.max(0, constraints.maxWidth)
      : naturalWidth(rows, this.showLineNumbers);
    const lines = this.mode === 'side-by-side'
      ? this.renderSideBySide(rows, maxWidth)
      : this.renderInline(rows, maxWidth);
    let width = 0;
    for (const line of lines) width = Math.max(width, visibleWidth(line));
    if (Number.isFinite(maxWidth)) width = Math.min(width, maxWidth);
    return { width, height: lines.length };
  }

  private rows(): DiffRow[] {
    const parts = applyContext(diffLines(splitLines(this.before), splitLines(this.after)), this.contextLines);
    const rows: DiffRow[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.type === 'equal') {
        rows.push({
          type: 'equal',
          beforeLine: part.beforeLine,
          afterLine: part.afterLine,
          beforeText: part.text,
          afterText: part.text,
        });
        continue;
      }
      if (part.type === 'insert') {
        rows.push({ type: 'insert', afterLine: part.afterLine, afterText: part.text });
        continue;
      }
      if (part.type === 'gap') {
        rows.push({ type: 'gap' });
        continue;
      }

      const deletes: Extract<DiffPart, { type: 'delete' }>[] = [];
      while (parts[i]?.type === 'delete') {
        deletes.push(parts[i] as Extract<DiffPart, { type: 'delete' }>);
        i++;
      }

      const inserts: Extract<DiffPart, { type: 'insert' }>[] = [];
      while (parts[i]?.type === 'insert') {
        inserts.push(parts[i] as Extract<DiffPart, { type: 'insert' }>);
        i++;
      }
      i--;

      const length = Math.max(deletes.length, inserts.length);
      for (let j = 0; j < length; j++) {
        const del = deletes[j];
        const ins = inserts[j];
        if (del && ins) {
          rows.push({
            type: 'replace',
            beforeLine: del.beforeLine,
            afterLine: ins.afterLine,
            beforeText: del.text,
            afterText: ins.text,
          });
        } else if (del) rows.push({ type: 'delete', beforeLine: del.beforeLine, beforeText: del.text });
        else if (ins) rows.push({ type: 'insert', afterLine: ins.afterLine, afterText: ins.text });
      }
    }

    return rows;
  }

  private renderInline(rows: DiffRow[], width: number): string[] {
    const lineNoWidth = this.lineNumberWidth(rows);
    const prefixWidth = this.showLineNumbers ? lineNoWidth * 2 + 5 : 2;
    const textWidth = Math.max(0, width - prefixWidth);

    return rows.flatMap((row) => {
      if (row.type === 'gap') return [fit(`${this.unchangedStyle}${'.'.repeat(Math.min(width, 3))}${RESET}`, width)];
      if (row.type === 'replace') {
        return [
          this.styleLine(
            this.removedStyle,
            `${this.inlinePrefix('-', row.beforeLine, undefined, lineNoWidth)}${fit(row.beforeText, textWidth)}`,
            width,
          ),
          this.styleLine(
            this.addedStyle,
            `${this.inlinePrefix('+', undefined, row.afterLine, lineNoWidth)}${fit(row.afterText, textWidth)}`,
            width,
          ),
        ];
      }
      if (row.type === 'delete') {
        return [
          this.styleLine(
            this.removedStyle,
            `${this.inlinePrefix('-', row.beforeLine, undefined, lineNoWidth)}${fit(row.beforeText, textWidth)}`,
            width,
          ),
        ];
      }
      if (row.type === 'insert') {
        return [
          this.styleLine(
            this.addedStyle,
            `${this.inlinePrefix('+', undefined, row.afterLine, lineNoWidth)}${fit(row.afterText, textWidth)}`,
            width,
          ),
        ];
      }
      return [
        this.styleLine(
          this.unchangedStyle,
          `${this.inlinePrefix(' ', row.beforeLine, row.afterLine, lineNoWidth)}${fit(row.beforeText, textWidth)}`,
          width,
        ),
      ];
    });
  }

  private renderSideBySide(rows: DiffRow[], width: number): string[] {
    const gutter = ' │ ';
    const columnWidth = Math.max(0, Math.floor((width - visibleWidth(gutter)) / 2));
    const lineNoWidth = this.lineNumberWidth(rows);

    return rows.map((row) => {
      if (row.type === 'gap') return fit(`${this.unchangedStyle}${'.'.repeat(Math.min(width, 3))}${RESET}`, width);
      if (row.type === 'replace') {
        return this.joinColumns(
          this.column(row.beforeLine, '-', row.beforeText, columnWidth, lineNoWidth, this.removedStyle),
          this.column(row.afterLine, '+', row.afterText, columnWidth, lineNoWidth, this.addedStyle),
          gutter,
          width,
        );
      }
      if (row.type === 'delete') {
        return this.joinColumns(
          this.column(row.beforeLine, '-', row.beforeText, columnWidth, lineNoWidth, this.removedStyle),
          this.column(undefined, ' ', '', columnWidth, lineNoWidth, this.unchangedStyle),
          gutter,
          width,
        );
      }
      if (row.type === 'insert') {
        return this.joinColumns(
          this.column(undefined, ' ', '', columnWidth, lineNoWidth, this.unchangedStyle),
          this.column(row.afterLine, '+', row.afterText, columnWidth, lineNoWidth, this.addedStyle),
          gutter,
          width,
        );
      }
      return this.joinColumns(
        this.column(row.beforeLine, ' ', row.beforeText, columnWidth, lineNoWidth, this.unchangedStyle),
        this.column(row.afterLine, ' ', row.afterText, columnWidth, lineNoWidth, this.unchangedStyle),
        gutter,
        width,
      );
    });
  }

  private inlinePrefix(
    marker: string,
    beforeLine: number | undefined,
    afterLine: number | undefined,
    lineNoWidth: number,
  ): string {
    if (!this.showLineNumbers) return `${marker} `;
    return `${formatLineNo(beforeLine, lineNoWidth)} ${formatLineNo(afterLine, lineNoWidth)} ${marker} `;
  }

  private column(
    lineNo: number | undefined,
    marker: string,
    text: string,
    width: number,
    lineNoWidth: number,
    style: string,
  ): string {
    const prefix = this.showLineNumbers ? `${formatLineNo(lineNo, lineNoWidth)} ${marker} ` : `${marker} `;
    const content = `${prefix}${fit(text, Math.max(0, width - visibleWidth(prefix)))}`;
    return this.styleLine(style, content, width);
  }

  private joinColumns(left: string, right: string, gutter: string, width: number): string {
    return fit(`${left}${this.unchangedStyle}${gutter}${RESET}${right}`, width);
  }

  private styleLine(style: string, content: string, width: number): string {
    return `${style}${fit(content, width)}${RESET}`;
  }

  private lineNumberWidth(rows: DiffRow[]): number {
    if (!this.showLineNumbers) return 0;
    let max = 0;
    for (const row of rows) {
      if ('beforeLine' in row) max = Math.max(max, row.beforeLine ?? 0);
      if ('afterLine' in row) max = Math.max(max, row.afterLine ?? 0);
    }
    return Math.max(1, String(max).length);
  }
}

function splitLines(value: string): string[] {
  if (value.length === 0) return [];
  const lines = value.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function diffLines(before: string[], after: string[]): DiffPart[] {
  const table = Array.from({ length: before.length + 1 }, () => Array(after.length + 1).fill(0) as number[]);
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      parts.push({ type: 'equal', beforeLine: i + 1, afterLine: j + 1, text: before[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      parts.push({ type: 'delete', beforeLine: i + 1, text: before[i] });
      i++;
    } else {
      parts.push({ type: 'insert', afterLine: j + 1, text: after[j] });
      j++;
    }
  }
  while (i < before.length) parts.push({ type: 'delete', beforeLine: i + 1, text: before[i++] });
  while (j < after.length) parts.push({ type: 'insert', afterLine: j + 1, text: after[j++] });
  return parts;
}

function applyContext(parts: DiffPart[], contextLines: number | undefined): Array<DiffPart | { type: 'gap' }> {
  if (contextLines === undefined || contextLines < 0 || parts.every((part) => part.type === 'equal')) return parts;
  const keep = new Set<number>();
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].type === 'equal') continue;
    for (let j = Math.max(0, i - contextLines); j <= Math.min(parts.length - 1, i + contextLines); j++) keep.add(j);
  }

  const result: Array<DiffPart | { type: 'gap' }> = [];
  let skipped = false;
  for (let i = 0; i < parts.length; i++) {
    if (keep.has(i)) {
      if (skipped) result.push({ type: 'gap' });
      result.push(parts[i]);
      skipped = false;
    } else {
      skipped = true;
    }
  }
  return result;
}

function formatLineNo(line: number | undefined, width: number): string {
  return line === undefined ? ' '.repeat(width) : String(line).padStart(width, ' ');
}

function naturalWidth(rows: DiffRow[], showLineNumbers: boolean): number {
  let maxLine = 0;
  let maxText = 0;
  for (const row of rows) {
    if ('beforeLine' in row) maxLine = Math.max(maxLine, row.beforeLine ?? 0);
    if ('afterLine' in row) maxLine = Math.max(maxLine, row.afterLine ?? 0);
    if ('beforeText' in row) maxText = Math.max(maxText, visibleWidth(row.beforeText));
    if ('afterText' in row) maxText = Math.max(maxText, visibleWidth(row.afterText));
  }
  const lineWidth = showLineNumbers ? Math.max(1, String(maxLine).length) + 3 : 2;
  return Math.max(1, lineWidth + maxText) * 2 + 3;
}

function fit(value: string, width: number): string {
  if (width <= 0) return '';
  const truncated = visibleWidth(value) > width ? truncateToWidth(value, width) : value;
  const padding = width - visibleWidth(truncated);
  return padding > 0 ? truncated + ' '.repeat(padding) : truncated;
}
