import type { InputEvent } from './events';
import type { GlobalKeybinding } from './keybinds';
import { keyMatches } from './keybinds';
import { containsPoint } from './layout/insets';
import { TerminalInputParser } from './parser';
import type { Component, SurfaceEntry } from './surface';

export interface InputRouterHost {
  getFocused(): Component | null;
  getEntries(): SurfaceEntry[];
  setTerminalFocused(focused: boolean): void;
  getTerminalFocused(): boolean;
  requestRender(force?: boolean): void;
}

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

  feed(data: string): void {
    this.dispatchEvents(this.parser.feed(data));

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
    for (const event of events) this.dispatchEvent(event);
  }

  dispatchEvent(event: InputEvent): void {
    for (const interceptor of this.inputInterceptors.slice()) {
      try {
        if (interceptor(event)) {
          this.host.requestRender();
          return;
        }
      } catch {
        // a faulty interceptor must not break input
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

    if (event.type === 'key' && this.handleGlobalKeybinding(event)) return;

    const focused = this.host.getFocused();
    if (event.type === 'key' && event.kind === 'release' && !focused?.wantsKeyRelease) return;

    if (focused?.handleInput) {
      focused.handleInput(event);
      this.host.requestRender();
    }
  }

  private handleMouseEvent(event: Extract<InputEvent, { type: 'mouse' }>): void {
    if (this.stopped) return;

    const entries = this.host.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (!entry.component.handleInput) continue;
      if (!containsPoint(entry.rect, event.x, event.y)) continue;
      const handled = entry.component.handleInput({
        ...event,
        localX: event.x - entry.rect.x,
        localY: event.y - entry.rect.y,
      });
      if (handled === false) continue;
      this.host.requestRender();
      return;
    }

    const focused = this.host.getFocused();
    if (focused?.handleInput) {
      focused.handleInput(event);
      this.host.requestRender();
    }
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
}
