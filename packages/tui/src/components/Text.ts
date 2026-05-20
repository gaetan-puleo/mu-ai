import type { Constraints, LayoutStyle, RenderContext, Size } from '../layout/types';
import type { Component } from '../types/component';
import { truncateToWidth, visibleWidth, wrapText } from '../utils';

export interface TextProps {
  text: string;
  /** Wrap text to fit content width. Default `true`. */
  wrap?: boolean;
  layout?: LayoutStyle;
}

/**
 * Render a string into `ctx.contentRect`. With `wrap: true` the text reflows
 * across lines; otherwise it is truncated horizontally with an ellipsis.
 *
 * `measure()` returns the natural size based on the text and an optional wrap
 * across the maximum width allowed by the constraints.
 */
export class Text implements Component {
  layout?: LayoutStyle;
  private _text: string;
  private _wrap: boolean;

  constructor(props: TextProps) {
    this._text = props.text;
    this._wrap = props.wrap ?? true;
    this.layout = props.layout;
  }

  get text(): string {
    return this._text;
  }

  setText(value: string): void {
    this._text = value;
  }

  setWrap(wrap: boolean): void {
    this._wrap = wrap;
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const lines = this.layoutText(this._text, width);
    if (lines.length <= height) return lines;
    return lines.slice(0, height);
  }

  measure(constraints: Constraints): Size {
    const maxWidth = Number.isFinite(constraints.maxWidth)
      ? Math.max(0, constraints.maxWidth)
      : naturalWidth(this._text);

    if (maxWidth <= 0) return { width: 0, height: 0 };

    const lines = this.layoutText(this._text, maxWidth);
    let width = 0;
    for (const line of lines) {
      const w = visibleWidth(line);
      if (w > width) width = w;
    }
    return { width, height: lines.length };
  }

  private layoutText(text: string, width: number): string[] {
    if (this._wrap) {
      return wrapText(text, width);
    }
    const lines = text.split('\n');
    return lines.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width) : line));
  }
}

function naturalWidth(text: string): number {
  let max = 0;
  for (const segment of text.split('\n')) {
    const w = visibleWidth(segment);
    if (w > max) max = w;
  }
  return max;
}
