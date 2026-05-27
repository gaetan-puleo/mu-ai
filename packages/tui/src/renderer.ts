import { performance } from 'node:perf_hooks';
import process from 'node:process';

import type { Capabilities } from './capabilities';
import { type CellBuffer, cellBufferToLines, createCellBuffer, setBackdropColor } from './layout/cellbuffer';
import type { Rgba } from './layout/color';
import { layoutTree, sortForRender } from './layout/engine';
import { drawEntry } from './layout/render';
import type { LayoutEntry, Rect } from './layout/types';
import type { Component } from './types/component';
import type { Terminal } from './types/terminal';
import { visibleWidth } from './utils';

/**
 * Host interface for the renderer — supplies the inputs needed to produce a
 * frame and a callback to publish the resulting layout entries (consumed by
 * input routing and focus traversal).
 */
export interface RendererHost {
  getChildren(): Component[];
  getFocusedComponent(): Component | null;
  getCapabilities(): Capabilities;
  getUserContext(): unknown;
  getBackdropColor(): Rgba;
  getTerminalFocused(): boolean;
  setLayoutEntries(entries: LayoutEntry[]): void;
}

/**
 * Owns render scheduling/throttle, the diff algorithm, and frame commit.
 * Extracted from the TUI orchestrator so each concern lives in one file.
 */
export class Renderer {
  private previousLines: string[] = [];
  private previousWidth = 0;
  private previousHeight = 0;
  private renderRequested = false;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRenderAt = 0;
  private cursorRow = 0;
  private hardwareCursorRow = 0;
  private maxLinesRendered = 0;
  private previousViewportTop = 0;
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
      this.previousLines = [];
      this.previousWidth = -1;
      this.previousHeight = -1;
      this.cursorRow = 0;
      this.hardwareCursorRow = 0;
      this.maxLinesRendered = 0;
      this.previousViewportTop = 0;
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

  /**
   * Build the frame for the current children at the given size and update the
   * host's cached layout entries.
   */
  private renderFrame(width: number, height: number): string[] {
    const rootRect: Rect = { x: 0, y: 0, width, height };
    const entries = layoutTree(this.host.getChildren(), rootRect, this.host.getFocusedComponent(), this.host.getCapabilities());
    this.host.setLayoutEntries(entries);

    const backdrop = this.host.getBackdropColor();
    const buffer: CellBuffer = createCellBuffer(width, height, backdrop);
    setBackdropColor(buffer, backdrop);
    const visualFocus = this.host.getTerminalFocused() ? this.host.getFocusedComponent() : null;
    for (const entry of sortForRender(entries)) {
      drawEntry(buffer, entry, visualFocus, this.host.getCapabilities(), this.host.getUserContext());
    }

    const lines = cellBufferToLines(buffer);
    let end = lines.length;
    while (end > 0 && /^ *$/.test(lines[end - 1])) end--;
    return end === lines.length ? lines : lines.slice(0, end);
  }

  doRender(): void {
    if (this.stopped) return;
    const width = this.terminal.columns;
    const height = this.terminal.rows;

    const widthChanged = this.previousWidth !== 0 && this.previousWidth !== width;
    const heightChanged = this.previousHeight !== 0 && this.previousHeight !== height;

    const newLines = this.renderFrame(width, height);
    this.assertLinesFit(newLines, width);

    const reset = '\x1b[0m\x1b]8;;\x07';
    for (let i = 0; i < newLines.length; i++) {
      newLines[i] += reset;
    }

    if (this.previousLines.length === 0 && !widthChanged && !heightChanged) {
      this.fullRender(newLines, false);
      return;
    }

    if (widthChanged || heightChanged) {
      this.fullRender(newLines, true);
      return;
    }

    let firstChanged = -1;
    let lastChanged = -1;
    const maxLines = Math.max(newLines.length, this.previousLines.length);
    for (let i = 0; i < maxLines; i++) {
      const oldLine = i < this.previousLines.length ? this.previousLines[i] : '';
      const newLine = i < newLines.length ? newLines[i] : '';
      if (oldLine !== newLine) {
        if (firstChanged === -1) firstChanged = i;
        lastChanged = i;
      }
    }

    if (firstChanged === -1) {
      this.positionCursor(newLines.length);
      this.previousHeight = height;
      return;
    }

    if (newLines.length > this.previousLines.length) {
      this.fullRender(newLines, false);
      return;
    }

    this.differentialRender(newLines, firstChanged, lastChanged, width, height);
  }

  private fullRender(lines: string[], clear: boolean): void {
    let buffer = this.frameStart();
    if (clear) {
      buffer += '\x1b[2J\x1b[H\x1b[3J';
    } else if (this.previousLines.length > 0) {
      buffer += '\x1b8'; // Restore the saved top-left anchor before repainting.
    }
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) buffer += '\r\n';
      buffer += lines[i];
    }
    // After writing all lines, move cursor back to the top-left of our content
    // and save that position. All subsequent diff renders will restore from
    // here, giving us a stable anchor that survives terminal scroll.
    if (lines.length > 0) {
      buffer += `\r\x1b[${lines.length - 1}A`;
    } else {
      buffer += '\r';
    }
    buffer += '\x1b7'; // DECSC — save cursor at our top-left anchor
    buffer += this.frameEnd();
    this.terminal.write(buffer);

    this.cursorRow = Math.max(0, lines.length - 1);
    this.hardwareCursorRow = 0; // anchor is now at row 0 of our content
    this.maxLinesRendered = clear ? lines.length : Math.max(this.maxLinesRendered, lines.length);
    const bufferLength = Math.max(this.terminal.rows, lines.length);
    this.previousViewportTop = Math.max(0, bufferLength - this.terminal.rows);
    this.previousLines = lines;
    this.previousWidth = this.terminal.columns;
    this.previousHeight = this.terminal.rows;
  }

  private differentialRender(
    newLines: string[],
    firstChanged: number,
    lastChanged: number,
    width: number,
    height: number,
  ): void {
    let buffer = this.frameStart();

    // Restore cursor to our saved anchor (top-left of content).
    // Then move down to the first changed line.
    buffer += '\x1b8'; // DECRC — restore cursor to anchor (row 0 of content)
    if (firstChanged > 0) {
      buffer += `\x1b[${firstChanged}B`;
    }
    buffer += '\r';

    const renderEnd = Math.min(lastChanged, newLines.length - 1);
    for (let i = firstChanged; i <= renderEnd; i++) {
      if (i > firstChanged) {
        buffer += '\x1b8';
        if (i > 0) buffer += `\x1b[${i}B`;
        buffer += '\r';
      }
      buffer += '\r\x1b[2K';
      buffer += newLines[i];
    }

    if (this.previousLines.length > newLines.length) {
      for (let i = newLines.length; i < this.previousLines.length; i++) {
        buffer += '\x1b8';
        if (i > 0) buffer += `\x1b[${i}B`;
        buffer += '\r';
        buffer += '\x1b[2K';
      }
    }

    // Restore cursor back to anchor so the anchor stays valid for next frame.
    buffer += '\x1b8';

    buffer += this.frameEnd();
    this.terminal.write(buffer);

    this.hardwareCursorRow = 0; // we restored to anchor
    this.cursorRow = Math.max(0, newLines.length - 1);
    this.maxLinesRendered = Math.max(this.maxLinesRendered, newLines.length);
    this.previousViewportTop = Math.max(0, this.previousViewportTop, this.hardwareCursorRow - height + 1);

    this.previousLines = newLines;
    this.previousWidth = width;
    this.previousHeight = height;
  }

  private positionCursor(totalLines: number): void {
    if (totalLines <= 0) {
      this.terminal.hideCursor();
      return;
    }
    const targetRow = Math.max(0, totalLines - 1);
    const rowDelta = targetRow - this.hardwareCursorRow;
    let buffer = '';
    if (rowDelta > 0) {
      buffer += `\x1b[${rowDelta}B`;
    } else if (rowDelta < 0) {
      buffer += `\x1b[${-rowDelta}A`;
    }
    if (buffer) {
      this.terminal.write(buffer);
    }
    this.hardwareCursorRow = targetRow;
    this.terminal.hideCursor();
  }

  /**
   * On shutdown, move the cursor below the last rendered line so subsequent
   * shell output appears beneath our final frame.
   */
  moveCursorAfterRenderedContent(): void {
    if (this.previousLines.length === 0) return;
    const targetRow = this.previousLines.length;
    const lineDiff = targetRow - this.hardwareCursorRow;
    if (lineDiff > 0) {
      this.terminal.write(`\x1b[${lineDiff}B`);
    } else if (lineDiff < 0) {
      this.terminal.write(`\x1b[${-lineDiff}A`);
    }
    this.terminal.write('\r\n');
  }

  private frameStart(): string {
    return this.useSynchronizedOutput ? '\x1b[?2026h' : '';
  }

  private frameEnd(): string {
    return this.useSynchronizedOutput ? '\x1b[?2026l' : '';
  }

  private assertLinesFit(lines: string[], width: number): void {
    for (let i = 0; i < lines.length; i++) {
      const lineWidth = visibleWidth(lines[i]);
      if (lineWidth > width) {
        throw new Error(`Rendered line ${i + 1} is ${lineWidth} columns wide, exceeding terminal width ${width}`);
      }
    }
  }
}
