import { performance } from 'node:perf_hooks';
import process from 'node:process';

import { cellsToAnsi } from './layout/ansi';
import {
  bufferUsedHeight,
  type CellBuffer,
  cellBufferToLines,
  createCellBuffer,
  diffBuffer,
  setBackdropColor,
} from './layout/cellbuffer';
import type { Rgba } from './layout/color';
import { type Component, renderToBuffer, type SurfaceEntry } from './surface';
import type { Terminal } from './types/terminal';

export interface RendererHost {
  getRoot(): Component | null;
  isFocused(component: Component): boolean;
  setEntries(entries: SurfaceEntry[]): void;
  getBackdropColor(): Rgba;
}

export class Renderer {
  private previousBuffer: CellBuffer | null = null;
  private previousUsedHeight = 0;
  private renderRequested = false;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRenderAt = 0;
  private stopped = false;

  private static readonly MIN_RENDER_INTERVAL_MS = 16;

  constructor(
    private readonly terminal: Terminal,
    private readonly host: RendererHost,
    private readonly useSynchronizedOutput: boolean,
  ) {}

  setStopped(stopped: boolean): void {
    this.stopped = stopped;
    if (stopped && this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = undefined;
    }
  }

  requestRender(force = false): void {
    if (force) {
      this.previousBuffer = null;
      this.previousUsedHeight = 0;
      if (this.renderTimer) {
        clearTimeout(this.renderTimer);
        this.renderTimer = undefined;
      }
      this.renderRequested = true;
      process.nextTick(() => {
        if (this.stopped || !this.renderRequested) return;
        this.renderRequested = false;
        this.lastRenderAt = performance.now();
        this.doRender();
      });
      return;
    }

    if (this.renderRequested) return;
    this.renderRequested = true;
    process.nextTick(() => this.scheduleRender());
  }

  private scheduleRender(): void {
    if (this.stopped || this.renderTimer || !this.renderRequested) return;
    const elapsed = performance.now() - this.lastRenderAt;
    const delay = Math.max(0, Renderer.MIN_RENDER_INTERVAL_MS - elapsed);
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      if (this.stopped || !this.renderRequested) return;
      this.renderRequested = false;
      this.lastRenderAt = performance.now();
      this.doRender();
      if (this.renderRequested) {
        this.scheduleRender();
      }
    }, delay);
  }

  private renderFrame(width: number, height: number): CellBuffer {
    const backdrop = this.host.getBackdropColor();
    const buffer = createCellBuffer(width, height, backdrop);
    setBackdropColor(buffer, backdrop);

    const root = this.host.getRoot();
    if (root) {
      this.host.setEntries(renderToBuffer(root, buffer, (component) => this.host.isFocused(component)));
    } else {
      this.host.setEntries([]);
    }
    return buffer;
  }

  doRender(): void {
    if (this.stopped) return;
    const width = this.terminal.columns;
    const height = this.terminal.rows;

    const buffer = this.renderFrame(width, height);
    const usedHeight = bufferUsedHeight(buffer);

    const prev = this.previousBuffer;
    const sizeChanged = prev !== null && (prev.width !== width || prev.height !== height);

    if (prev === null || sizeChanged || usedHeight > this.previousUsedHeight) {
      this.fullRender(buffer, usedHeight, sizeChanged);
    } else {
      this.cellDiffRender(prev, buffer, usedHeight);
    }

    this.previousBuffer = buffer;
    this.previousUsedHeight = usedHeight;
  }

  private fullRender(buffer: CellBuffer, usedHeight: number, clear: boolean): void {
    const lines = cellBufferToLines(buffer).slice(0, usedHeight);
    const reset = '\x1b[0m\x1b]8;;\x07';
    for (let i = 0; i < lines.length; i++) lines[i] += reset;

    let out = this.frameStart();
    if (clear) {
      out += '\x1b[2J\x1b[H\x1b[3J';
    } else if (this.previousBuffer !== null) {
      out += '\x1b8';
    }

    for (let i = 0; i < lines.length; i++) {
      if (i > 0) out += '\r\n';
      out += lines[i];
    }

    if (lines.length > 1) {
      out += `\r\x1b[${lines.length - 1}A`;
    } else {
      out += '\r';
    }
    out += '\x1b7';
    out += this.frameEnd();
    this.terminal.write(out);
  }

  private cellDiffRender(prev: CellBuffer, next: CellBuffer, usedHeight: number): void {
    const maxRow = Math.max(usedHeight, this.previousUsedHeight);
    const runs = diffBuffer(prev, next, maxRow);
    if (runs.length === 0) return;

    let out = this.frameStart();
    let curRow = -1;
    for (const run of runs) {
      if (run.y !== curRow) {
        out += '\x1b8';
        if (run.y > 0) out += `\x1b[${run.y}B`;
        curRow = run.y;
      }
      if (run.clear) {
        out += '\x1b[0m\x1b[2K';
      } else {
        out += `\x1b[${run.x + 1}G`;
        out += cellsToAnsi(run.cells);
      }
    }
    out += '\x1b8';
    out += this.frameEnd();
    this.terminal.write(out);
  }

  moveCursorAfterRenderedContent(): void {
    if (this.previousBuffer === null) return;
    let out = '';
    if (this.previousUsedHeight > 0) out += `\x1b[${this.previousUsedHeight}B`;
    out += '\r\n';
    this.terminal.write(out);
  }

  private frameStart(): string {
    return this.useSynchronizedOutput ? '\x1b[?2026h' : '';
  }

  private frameEnd(): string {
    return this.useSynchronizedOutput ? '\x1b[?2026l' : '';
  }
}
