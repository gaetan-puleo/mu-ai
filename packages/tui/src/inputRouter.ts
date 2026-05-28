import type { InputEvent } from './events';
import type { GlobalKeybinding } from './keybinds';
import { keyMatches } from './keybinds';
import { hitTest } from './layout/hitTest';
import type { EventContext, LayoutEntry, Rect } from './layout/types';
import { TerminalInputParser } from './parser';
import type { Component } from './types/component';
import type { Terminal } from './types/terminal';

/**
 * Host interface for the input router. Provides access to focus/layout state
 * that input dispatch needs, plus the render trigger and a setter for the
 * terminal-focused flag (which is owned by the router but consumed by the
 * renderer to drive focus-visual styling).
 */
export interface InputRouterHost {
  getTerminal(): Terminal;
  getLayoutEntries(): LayoutEntry[];
  getFocusedComponent(): Component | null;
  getUserContext(): unknown;
  setTerminalFocused(focused: boolean): void;
  getTerminalFocused(): boolean;
  requestRender(force?: boolean): void;
}

/**
 * Owns input parsing, interceptor list, global keybindings, and dispatch into
 * focused components and mouse hit targets. Buffers pending escape sequences
 * until they complete or time out.
 */
export class InputRouter {
  private readonly parser: TerminalInputParser;
  private readonly inputInterceptors: Array<(event: InputEvent) => boolean | undefined> = [];
  private readonly globalKeybindings: GlobalKeybinding[] = [];
  private pendingEscapeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly escapeTimeoutMs = 25;
  private stopped = false;

  constructor(private readonly host: InputRouterHost) {
    this.parser = new TerminalInputParser();
  }

  setStopped(stopped: boolean): void {
    this.stopped = stopped;
    if (stopped && this.pendingEscapeTimer) {
      clearTimeout(this.pendingEscapeTimer);
      this.pendingEscapeTimer = undefined;
    }
  }

  addInputInterceptor(listener: (event: InputEvent) => boolean | undefined): () => void {
    this.inputInterceptors.push(listener);
    return () => {
      const index = this.inputInterceptors.indexOf(listener);
      if (index !== -1) this.inputInterceptors.splice(index, 1);
    };
  }

  addGlobalKeybinding(binding: GlobalKeybinding): () => void {
    this.globalKeybindings.push(binding);
    return () => {
      const index = this.globalKeybindings.indexOf(binding);
      if (index !== -1) this.globalKeybindings.splice(index, 1);
    };
  }

  /**
   * Feed raw terminal input into the parser and dispatch any complete events.
   * Manages the escape-timeout flush for sequences that don't complete in a
   * single chunk.
   */
  feed(data: string): void {
    const events = this.parser.feed(data);
    this.dispatchEvents(events);

    if (this.parser.hasPending()) {
      if (!this.pendingEscapeTimer) {
        this.pendingEscapeTimer = setTimeout(() => {
          this.pendingEscapeTimer = undefined;
          this.dispatchEvents(this.parser.flushPending());
        }, this.escapeTimeoutMs);
      }
    } else if (this.pendingEscapeTimer) {
      clearTimeout(this.pendingEscapeTimer);
      this.pendingEscapeTimer = undefined;
    }
  }

  private dispatchEvents(events: InputEvent[]): void {
    for (const event of events) {
      this.dispatchEvent(event);
    }
  }

  dispatchEvent(event: InputEvent): void {
    for (const interceptor of this.inputInterceptors.slice()) {
      try {
        if (interceptor(event)) {
          this.host.requestRender();
          return;
        }
      } catch {
        /* interceptor errors must not break input handling */
      }
    }

    if (event.type === 'mouse') {
      this.handleMouseEvent(event);
      return;
    }

    if (event.type === 'focus') {
      if (this.host.getTerminalFocused() !== event.focused) {
        this.host.setTerminalFocused(event.focused);
        this.host.requestRender();
      }
      return;
    }

    if (event.type === 'key' && this.handleGlobalKeybinding(event)) {
      return;
    }

    const focused = this.host.getFocusedComponent();
    if (event.type === 'key' && event.kind === 'release' && !focused?.wantsKeyRelease) {
      return;
    }

    if (focused?.handleEvent) {
      focused.handleEvent(event, this.focusedEventContext());
      this.host.requestRender();
    }
  }

  private handleMouseEvent(event: Extract<InputEvent, { type: 'mouse' }>): void {
    if (this.stopped) return;

    const entries = this.host.getLayoutEntries();
    const entry = hitTest(entries, event.x, event.y);
    // Build a Component→LayoutEntry index once per event so the parent walk
    // is O(depth) instead of O(N × depth).
    const target = entry ? this.findMouseEventTarget(entry, this.byComponent(entries)) : null;
    if (target) {
      const ctx: EventContext = {
        rect: target.rect,
        contentRect: target.contentRect,
        localX: event.x - target.contentRect.x,
        localY: event.y - target.contentRect.y,
        focused: target.component === this.host.getFocusedComponent(),
        userContext: this.host.getUserContext(),
      };
      target.component.handleEvent?.(event, ctx);
      this.host.requestRender();
      return;
    }

    const focused = this.host.getFocusedComponent();
    if (focused?.handleEvent) {
      focused.handleEvent(event, this.focusedEventContext());
      this.host.requestRender();
    }
  }

  private findMouseEventTarget(entry: LayoutEntry, index: Map<Component, LayoutEntry>): LayoutEntry | null {
    let current: LayoutEntry | undefined = entry;
    while (current) {
      if (current.component.handleEvent) return current;
      current = current.parent ? index.get(current.parent) : undefined;
    }
    return null;
  }

  private byComponent(entries: LayoutEntry[]): Map<Component, LayoutEntry> {
    const out = new Map<Component, LayoutEntry>();
    for (const e of entries) out.set(e.component, e);
    return out;
  }

  private handleGlobalKeybinding(event: InputEvent): boolean {
    if (event.type !== 'key') return false;
    for (const binding of this.globalKeybindings) {
      if (keyMatches(binding.chord, event)) {
        binding.handler(event);
        return true;
      }
    }
    return false;
  }

  private focusedEventContext(): EventContext {
    const focused = this.host.getFocusedComponent();
    const entries = this.host.getLayoutEntries();
    const focusedEntry = entries.find((e) => e.component === focused);
    if (focusedEntry) {
      return {
        rect: focusedEntry.rect,
        contentRect: focusedEntry.contentRect,
        focused: true,
        userContext: this.host.getUserContext(),
      };
    }
    const terminal = this.host.getTerminal();
    const fallbackRect: Rect = { x: 0, y: 0, width: terminal.columns, height: terminal.rows };
    return { rect: fallbackRect, contentRect: fallbackRect, focused: true, userContext: this.host.getUserContext() };
  }
}
