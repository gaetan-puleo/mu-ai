import { performance } from 'node:perf_hooks';
import process from 'node:process';

import {
  type Capabilities,
  createDefaultCapabilities,
  mergeCapabilities,
  type PartialCapabilities,
} from './capabilities';
import type { InputEvent } from './events';
import { createRuntimeEnv, type FeatureContext, type TuiFeature } from './feature';
import type { GlobalKeybinding } from './keybinds';
import { keyMatches } from './keybinds';
import { type CellBuffer, cellBufferToLines, createCellBuffer, setBackdropColor } from './layout/cellbuffer';
import { colorToRgba, OPAQUE_BLACK, type Rgba } from './layout/color';
import { layoutTree, sortForRender } from './layout/engine';
import { hitTest } from './layout/hitTest';
import { drawEntry } from './layout/render';
import type { Color, EventContext, LayoutEntry, Rect } from './layout/types';
import { TerminalInputParser } from './parser';
import type { Component } from './types/component';
import { isFocusable, isFocusableNavigation } from './types/guards';
import type { Terminal } from './types/terminal';
import { visibleWidth } from './utils';

interface StartableTerminal extends Terminal {
  start?: (onInput: (data: string) => void, onResize: () => void) => void;
  stop?: () => void;
}

export interface TuiOptions {
  capabilities?: PartialCapabilities;
  features?: TuiFeature[];
  synchronizedOutput?: boolean;
  escapeTimeoutMs?: number;
  maxInputBufferBytes?: number;
  maxPasteBytes?: number;
  /**
   * Application-defined value forwarded into every `RenderContext.userContext`
   * and `EventContext.userContext`. The TUI core treats this as opaque data;
   * intended for consumer-defined providers such as theming.
   */
  userContext?: unknown;
}

export class TUI {
  private terminal: Terminal;
  private capabilities: Capabilities;
  private previousLines: string[] = [];
  private previousWidth = 0;
  private previousHeight = 0;
  private focusedComponent: Component | null = null;
  private inputInterceptors: Array<(event: InputEvent) => boolean | undefined> = [];
  private inputListeners: Array<(event: InputEvent) => void> = [];
  private rawInputListeners: Array<(data: string) => void> = [];
  private renderRequested = false;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingEscapeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRenderAt = 0;
  private static readonly MIN_RENDER_INTERVAL_MS = 16;
  private cursorRow = 0;
  private hardwareCursorRow = 0;
  private maxLinesRendered = 0;
  private previousViewportTop = 0;
  private stopped = false;
  private terminalFocused = true;
  private children: Component[] = [];
  private layoutEntries: LayoutEntry[] = [];
  private globalKeybindings: GlobalKeybinding[] = [];
  private confirmBuffer: { chord: GlobalKeybinding; timestamp: number } | null = null;
  private readonly confirmTimeoutMs = 500;
  private readonly parser: TerminalInputParser;
  private readonly features: TuiFeature[];
  private readonly featureCleanups: Array<() => void> = [];
  private readonly useSynchronizedOutput: boolean;
  private readonly escapeTimeoutMs: number;
  private started = false;
  private userContext: unknown;
  private backdropColor: Rgba = OPAQUE_BLACK;

  onDebug?: () => void;

  constructor(terminal: Terminal, options: TuiOptions = {}) {
    this.terminal = terminal;
    this.features = options.features ?? [];
    this.useSynchronizedOutput = options.synchronizedOutput ?? true;
    this.escapeTimeoutMs = options.escapeTimeoutMs ?? 25;
    this.userContext = options.userContext;
    this.parser = new TerminalInputParser({
      maxBufferBytes: options.maxInputBufferBytes,
      maxPasteBytes: options.maxPasteBytes,
    });

    const terminalCaps = (terminal as { capabilities?: Capabilities }).capabilities;
    this.capabilities = mergeCapabilities(terminalCaps ?? createDefaultCapabilities(), options.capabilities);
    this.detectFeatureCapabilities();
  }

  getCapabilities(): Capabilities {
    return this.capabilities;
  }

  updateCapabilities(patch: PartialCapabilities): void {
    this.capabilities = mergeCapabilities(this.capabilities, patch);
  }

  /**
   * Update the application-defined context value forwarded into render/event
   * contexts. Triggers a full redraw so consumers immediately see the new
   * value.
   */
  setUserContext(value: unknown): void {
    this.userContext = value;
    this.requestRender(true);
  }

  getUserContext(): unknown {
    return this.userContext;
  }

  /**
   * Set the terminal's effective background color. This is the color used as
   * the base when compositing semi-transparent layers — without it, transparent
   * overlays would composite against black instead of the user's actual
   * terminal background.
   */
  setBackgroundColor(color: Color): void {
    const rgba = colorToRgba(color);
    this.backdropColor = { ...rgba, a: 1 };
    this.requestRender(true);
  }

  getBackgroundColor(): Rgba {
    return this.backdropColor;
  }

  addGlobalKeybinding(binding: GlobalKeybinding): () => void {
    this.globalKeybindings.push(binding);
    return () => {
      const index = this.globalKeybindings.indexOf(binding);
      if (index !== -1) this.globalKeybindings.splice(index, 1);
    };
  }

  addChild(component: Component): void {
    this.children.push(component);
  }

  removeChild(component: Component): void {
    const index = this.children.indexOf(component);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }

  setFocus(component: Component | null): void {
    if (isFocusable(this.focusedComponent)) {
      this.focusedComponent.focused = false;
    }
    this.focusedComponent = component;
    if (isFocusable(component)) {
      component.focused = true;
    }
  }

  getFocused(): Component | null {
    return this.focusedComponent;
  }

  /**
   * Focusable components in layout order (depth, then insertion order).
   * Components with `layout.focusable === true` or implementing `Focusable`
   * are included.
   */
  getFocusableComponents(): Component[] {
    return this.layoutEntries
      .slice()
      .sort((a, b) => (a.depth !== b.depth ? a.depth - b.depth : a.order - b.order))
      .map((entry) => entry.component)
      .filter((c) => c.layout?.focusable === true || isFocusable(c));
  }

  /**
   * Focus traversal:
   * 1. If the focused component implements `FocusableNavigation`, defer to it.
   * 2. Otherwise, walk the flat focusable list from the layout pass.
   * 3. Fall back to the top-level children order when no layout entries exist
   *    (e.g. before the first render).
   */
  navigateFocus(direction: 'up' | 'down' | 'left' | 'right'): Component | null {
    if (isFocusableNavigation(this.focusedComponent)) {
      const next = direction === 'down' || direction === 'right'
        ? this.focusedComponent.focusNext?.()
        : this.focusedComponent.focusPrev?.();
      if (next) {
        this.setFocus(next);
        return next;
      }
    }

    const focusables = this.getFocusableComponents();
    const pool = focusables.length > 0 ? focusables : this.children;
    if (pool.length === 0) return null;

    const currentIndex = this.focusedComponent ? pool.indexOf(this.focusedComponent) : -1;
    const forward = direction === 'down' || direction === 'right';
    const nextIndex = forward ? (currentIndex + 1) % pool.length : (currentIndex - 1 + pool.length) % pool.length;

    const next = pool[nextIndex];
    this.setFocus(next);
    return next;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    const t = this.terminal as StartableTerminal;
    t.start?.(
      (data: string) => this.handleRawInput(data),
      () => this.handleResize(),
    );
    this.setupFeatures();
    this.terminal.hideCursor();
    this.requestRender();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.stopped = true;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = undefined;
    }
    if (this.pendingEscapeTimer) {
      clearTimeout(this.pendingEscapeTimer);
      this.pendingEscapeTimer = undefined;
    }

    this.cleanupFeatures();
    this.moveCursorAfterRenderedContent();

    const t = this.terminal as StartableTerminal;
    t.stop?.();
    this.terminal.showCursor();
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

  addInputListener(listener: (event: InputEvent) => void): () => void {
    this.inputListeners.push(listener);
    return () => {
      const index = this.inputListeners.indexOf(listener);
      if (index !== -1) this.inputListeners.splice(index, 1);
    };
  }

  addInputInterceptor(listener: (event: InputEvent) => boolean | undefined): () => void {
    this.inputInterceptors.push(listener);
    return () => {
      const index = this.inputInterceptors.indexOf(listener);
      if (index !== -1) this.inputInterceptors.splice(index, 1);
    };
  }

  addRawInputListener(listener: (data: string) => void): () => void {
    this.rawInputListeners.push(listener);
    return () => {
      const index = this.rawInputListeners.indexOf(listener);
      if (index !== -1) this.rawInputListeners.splice(index, 1);
    };
  }

  invalidate(): void {
    for (const child of this.children) {
      this.invalidateRecursive(child);
    }
  }

  /** Build a one-off layout snapshot for the current children at the given size. */
  layoutSnapshot(width: number = this.terminal.columns, height: number = this.terminal.rows): LayoutEntry[] {
    const rootRect: Rect = { x: 0, y: 0, width, height };
    return layoutTree(this.children, rootRect, this.focusedComponent, this.capabilities);
  }

  /** The cached entries from the last render pass (used by hit testing). */
  getLayoutEntries(): LayoutEntry[] {
    return this.layoutEntries;
  }

  handleMouseEvent(event: Extract<InputEvent, { type: 'mouse' }>): void {
    if (this.stopped) return;

    const entry = hitTest(this.layoutEntries, event.x, event.y);
    const target = entry ? this.findMouseEventTarget(entry) : null;
    if (target) {
      const ctx: EventContext = {
        rect: target.rect,
        contentRect: target.contentRect,
        localX: event.x - target.contentRect.x,
        localY: event.y - target.contentRect.y,
        focused: target.component === this.focusedComponent,
        userContext: this.userContext,
      };
      target.component.handleEvent?.(event, ctx);
      this.requestRender();
      return;
    }

    if (this.focusedComponent?.handleEvent) {
      this.focusedComponent.handleEvent(event, this.focusedEventContext());
      this.requestRender();
    }
  }

  private findMouseEventTarget(entry: LayoutEntry): LayoutEntry | null {
    let current: LayoutEntry | undefined = entry;
    while (current) {
      if (current.component.handleEvent) return current;
      current = current.parent
        ? this.layoutEntries.find((candidate) => candidate.component === current?.parent)
        : undefined;
    }
    return null;
  }

  private scheduleRender(): void {
    if (this.stopped || this.renderTimer || !this.renderRequested) return;
    const elapsed = performance.now() - this.lastRenderAt;
    const delay = Math.max(0, TUI.MIN_RENDER_INTERVAL_MS - elapsed);
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

  private handleRawInput(data: string): void {
    for (const listener of this.rawInputListeners) {
      try {
        listener(data);
      } catch {
        /* listener errors must not break input handling */
      }
    }

    if (this.pendingEscapeTimer) {
      clearTimeout(this.pendingEscapeTimer);
      this.pendingEscapeTimer = undefined;
    }

    const events = this.parser.feed(data);
    this.dispatchEvents(events);

    if (this.parser.hasPending()) {
      this.pendingEscapeTimer = setTimeout(() => {
        this.pendingEscapeTimer = undefined;
        this.dispatchEvents(this.parser.flushPending());
      }, this.escapeTimeoutMs);
    }
  }

  private handleResize(): void {
    this.dispatchEvent({ type: 'resize', columns: this.terminal.columns, rows: this.terminal.rows });
    this.requestRender(true);
  }

  private dispatchEvents(events: InputEvent[]): void {
    for (const event of events) {
      this.dispatchEvent(event);
    }
  }

  private dispatchEvent(event: InputEvent): void {
    for (const interceptor of this.inputInterceptors) {
      try {
        if (interceptor(event)) {
          this.requestRender();
          return;
        }
      } catch {
        /* interceptor errors must not break input handling */
      }
    }

    for (const listener of this.inputListeners) {
      try {
        listener(event);
      } catch {
        /* listener errors must not break input handling */
      }
    }

    for (const feature of this.features) {
      feature.handleEvent?.(event, this.createFeatureContext());
    }

    if (event.type === 'mouse') {
      this.handleMouseEvent(event);
      return;
    }

    if (event.type === 'focus') {
      if (this.terminalFocused !== event.focused) {
        this.terminalFocused = event.focused;
        this.requestRender();
      }
      return;
    }

    if (event.type === 'key' && this.handleGlobalKeybinding(event)) {
      return;
    }

    if (event.type === 'key' && event.raw === '\x1b[22;32u' && this.onDebug) {
      this.onDebug();
      return;
    }

    if (event.type === 'key' && event.kind === 'release' && !this.focusedComponent?.wantsKeyRelease) {
      return;
    }

    if (this.focusedComponent?.handleEvent) {
      this.focusedComponent.handleEvent(event, this.focusedEventContext());
      this.requestRender();
    }
  }

  private handleGlobalKeybinding(event: InputEvent): boolean {
    for (const binding of this.globalKeybindings) {
      if (keyMatches(binding.chord, event)) {
        if (binding.confirm) {
          if (this.confirmBuffer?.chord === binding) {
            binding.handler();
            this.confirmBuffer = null;
            return true;
          }
          this.confirmBuffer = { chord: binding, timestamp: Date.now() };
          setTimeout(() => {
            if (this.confirmBuffer?.chord === binding) {
              this.confirmBuffer = null;
            }
          }, this.confirmTimeoutMs);
          return true;
        }
        binding.handler();
        return true;
      }
    }

    this.confirmBuffer = null;
    return false;
  }

  private focusedEventContext(): EventContext {
    const focusedEntry = this.layoutEntries.find((e) => e.component === this.focusedComponent);
    if (focusedEntry) {
      return {
        rect: focusedEntry.rect,
        contentRect: focusedEntry.contentRect,
        focused: true,
        userContext: this.userContext,
      };
    }
    const fallbackRect: Rect = { x: 0, y: 0, width: this.terminal.columns, height: this.terminal.rows };
    return { rect: fallbackRect, contentRect: fallbackRect, focused: true, userContext: this.userContext };
  }

  private invalidateRecursive(component: Component): void {
    component.invalidate?.();
    if (component.children) {
      for (const child of component.children) this.invalidateRecursive(child);
    }
  }

  private renderFrame(width: number, height: number): string[] {
    const rootRect: Rect = { x: 0, y: 0, width, height };
    const entries = layoutTree(this.children, rootRect, this.focusedComponent, this.capabilities);
    this.layoutEntries = entries;

    const buffer: CellBuffer = createCellBuffer(width, height, this.backdropColor);
    setBackdropColor(buffer, this.backdropColor);
    const visualFocus = this.terminalFocused ? this.focusedComponent : null;
    for (const entry of sortForRender(entries)) {
      drawEntry(buffer, entry, visualFocus, this.capabilities, this.userContext);
    }

    const lines = cellBufferToLines(buffer);
    let end = lines.length;
    while (end > 0 && /^ *$/.test(lines[end - 1])) end--;
    return end === lines.length ? lines : lines.slice(0, end);
  }

  private doRender(): void {
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

  private moveCursorAfterRenderedContent(): void {
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

  private detectFeatureCapabilities(): void {
    const env = createRuntimeEnv(this.terminal);
    for (const feature of this.features) {
      const patch = feature.detect?.(env);
      if (patch) this.updateCapabilities(patch);
    }
  }

  private setupFeatures(): void {
    for (const feature of this.features) {
      feature.setup?.(this.createFeatureContext());
    }
  }

  private cleanupFeatures(): void {
    for (let i = this.features.length - 1; i >= 0; i--) {
      this.features[i].cleanup?.(this.createFeatureContext());
    }
    for (let i = this.featureCleanups.length - 1; i >= 0; i--) {
      this.featureCleanups[i]();
    }
    this.featureCleanups.length = 0;
  }

  private createFeatureContext(): FeatureContext {
    return {
      terminal: this.terminal,
      capabilities: this.capabilities,
      write: (data: string) => this.terminal.write(data),
      enableMode: (mode) => this.terminal.enableMode?.(mode),
      disableMode: (mode) => this.terminal.disableMode?.(mode),
      updateCapabilities: (patch) => this.updateCapabilities(patch),
      addCleanup: (cleanup) => this.featureCleanups.push(cleanup),
    };
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

