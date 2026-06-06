import type { InputEvent } from './events';
import { parseLine } from './layout/ansi';
import { type CellBuffer, fillBackground, popOpacity, pushOpacity, writeCells } from './layout/cellbuffer';
import { colorToRgba } from './layout/color';
import { intersectRect } from './layout/insets';
import type { Color, Rect } from './layout/types';
import { visibleWidth } from './utils';

export interface Component {
  render(surface: Surface): void;
  handleInput?(event: InputEvent): boolean | void;
  wantsKeyRelease?: boolean;
}

export interface Surface {
  readonly width: number;
  readonly height: number;
  readonly focused: boolean;
  text(x: number, y: number, value: string): void;
  fill(rect: Rect, color: Color, opacity?: number): void;
  measure(child: Component, width: number): number;
  child(child: Component, rect: Rect, opts?: { opacity?: number; focused?: boolean }): void;
}

export interface SurfaceEntry {
  component: Component;
  rect: Rect;
}

interface Env {
  buffer: CellBuffer;
  isFocused: (component: Component) => boolean;
  entries: SurfaceEntry[];
}

class BufferSurface implements Surface {
  constructor(
    private readonly env: Env,
    private readonly ox: number,
    private readonly oy: number,
    readonly width: number,
    readonly height: number,
    private readonly clip: Rect,
    readonly focused: boolean,
  ) {}

  text(x: number, y: number, value: string): void {
    if (y < 0 || y >= this.height) return;
    writeCells(this.env.buffer, this.ox + x, this.oy + y, parseLine(value), this.clip);
  }

  fill(rect: Rect, color: Color, opacity = 1): void {
    const abs: Rect = { x: this.ox + rect.x, y: this.oy + rect.y, width: rect.width, height: rect.height };
    fillBackground(this.env.buffer, abs, colorToRgba(color, opacity), this.clip);
  }

  measure(child: Component, width: number): number {
    return measure(child, width);
  }

  child(child: Component, rect: Rect, opts?: { opacity?: number; focused?: boolean }): void {
    const ox = this.ox + rect.x;
    const oy = this.oy + rect.y;
    const abs: Rect = { x: ox, y: oy, width: rect.width, height: rect.height };
    const clip = intersectRect(this.clip, abs);
    const focused = opts?.focused ?? this.env.isFocused(child);
    const sub = new BufferSurface(this.env, ox, oy, rect.width, rect.height, clip, focused);
    this.env.entries.push({ component: child, rect: abs });
    const dim = opts?.opacity !== undefined && opts.opacity < 1;
    if (dim) pushOpacity(this.env.buffer, opts!.opacity!);
    child.render(sub);
    if (dim) popOpacity(this.env.buffer);
  }
}

class ProbeSurface implements Surface {
  maxRow = 0;
  maxCol = 0;
  readonly height = Number.POSITIVE_INFINITY;
  readonly focused = false;

  constructor(readonly width: number) {}

  private bumpRow(row: number): void {
    if (row > this.maxRow) this.maxRow = row;
  }

  private bumpCol(col: number): void {
    if (col > this.maxCol) this.maxCol = col;
  }

  text(x: number, y: number, value: string): void {
    this.bumpRow(y + value.split('\n').length);
    let width = 0;
    for (const line of value.split('\n')) {
      const lineWidth = visibleWidth(line);
      if (lineWidth > width) width = lineWidth;
    }
    this.bumpCol(x + width);
  }

  fill(rect: Rect): void {
    if (Number.isFinite(rect.height)) this.bumpRow(rect.y + rect.height);
    if (Number.isFinite(rect.width)) this.bumpCol(rect.x + rect.width);
  }

  measure(child: Component, width: number): number {
    return measure(child, width);
  }

  child(_child: Component, rect: Rect): void {
    if (Number.isFinite(rect.height)) this.bumpRow(rect.y + rect.height);
    if (Number.isFinite(rect.width)) this.bumpCol(rect.x + rect.width);
  }
}

export function measure(component: Component, width: number): number {
  const probe = new ProbeSurface(Math.max(0, width));
  component.render(probe);
  return probe.maxRow;
}

export function measureWidth(component: Component, maxWidth: number): number {
  const probe = new ProbeSurface(Math.max(0, maxWidth));
  component.render(probe);
  return probe.maxCol;
}

export function renderToBuffer(
  component: Component,
  buffer: CellBuffer,
  isFocused: (component: Component) => boolean = () => false,
): SurfaceEntry[] {
  const entries: SurfaceEntry[] = [];
  const env: Env = { buffer, isFocused, entries };
  const clip: Rect = { x: 0, y: 0, width: buffer.width, height: buffer.height };
  component.render(new BufferSurface(env, 0, 0, buffer.width, buffer.height, clip, false));
  return entries;
}
