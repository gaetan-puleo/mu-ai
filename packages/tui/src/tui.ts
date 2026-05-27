import {
  type Capabilities,
  createDefaultCapabilities,
  mergeCapabilities,
  type PartialCapabilities,
} from './capabilities';
import type { InputEvent } from './events';
import { FocusManager } from './focusManager';
import { InputRouter } from './inputRouter';
import type { GlobalKeybinding } from './keybinds';
import { colorToRgba, OPAQUE_BLACK, type Rgba } from './layout/color';
import type { Color, LayoutEntry } from './layout/types';
import { Renderer } from './renderer';
import type { Component } from './types/component';
import type { Terminal } from './types/terminal';

interface StartableTerminal extends Terminal {
  start?: (onInput: (data: string) => void, onResize: () => void) => void;
  stop?: () => void;
}

export interface TuiOptions {
  capabilities?: PartialCapabilities;
  synchronizedOutput?: boolean;
  /**
   * Application-defined value forwarded into every `RenderContext.userContext`
   * and `EventContext.userContext`. The TUI core treats this as opaque data;
   * intended for consumer-defined providers such as theming.
   */
  userContext?: unknown;
}

/**
 * Orchestrator that owns lifecycle, terminal binding, and the top-level
 * children/capabilities state. Delegates rendering to {@link Renderer},
 * input dispatch to {@link InputRouter}, and focus traversal to
 * {@link FocusManager} — each in a sibling module.
 */
export class TUI {
  private readonly terminal: Terminal;
  private readonly capabilities: Capabilities;
  private readonly children: Component[] = [];
  private layoutEntries: LayoutEntry[] = [];
  private started = false;
  private terminalFocused = true;
  private userContext: unknown;
  private backdropColor: Rgba = OPAQUE_BLACK;

  private readonly renderer: Renderer;
  private readonly inputRouter: InputRouter;
  private readonly focusManager: FocusManager;

  constructor(terminal: Terminal, options: TuiOptions = {}) {
    this.terminal = terminal;
    this.userContext = options.userContext;

    const terminalCaps = (terminal as { capabilities?: Capabilities }).capabilities;
    this.capabilities = mergeCapabilities(terminalCaps ?? createDefaultCapabilities(), options.capabilities);

    this.focusManager = new FocusManager({
      getLayoutEntries: () => this.layoutEntries,
      getChildren: () => this.children,
    });

    this.renderer = new Renderer(
      terminal,
      {
        getChildren: () => this.children,
        getFocusedComponent: () => this.focusManager.getFocused(),
        getCapabilities: () => this.capabilities,
        getUserContext: () => this.userContext,
        getBackdropColor: () => this.backdropColor,
        getTerminalFocused: () => this.terminalFocused,
        setLayoutEntries: (entries) => {
          this.layoutEntries = entries;
        },
      },
      options.synchronizedOutput ?? true,
    );

    this.inputRouter = new InputRouter({
      getTerminal: () => this.terminal,
      getLayoutEntries: () => this.layoutEntries,
      getFocusedComponent: () => this.focusManager.getFocused(),
      getUserContext: () => this.userContext,
      getTerminalFocused: () => this.terminalFocused,
      setTerminalFocused: (focused) => {
        this.terminalFocused = focused;
      },
      requestRender: (force) => this.requestRender(force),
    });
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

  addGlobalKeybinding(binding: GlobalKeybinding): () => void {
    return this.inputRouter.addGlobalKeybinding(binding);
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
    this.focusManager.setFocus(component);
  }

  getFocused(): Component | null {
    return this.focusManager.getFocused();
  }

  navigateFocus(direction: 'up' | 'down' | 'left' | 'right'): Component | null {
    return this.focusManager.navigateFocus(direction);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.renderer.setStopped(false);
    this.inputRouter.setStopped(false);
    const t = this.terminal as StartableTerminal;
    t.start?.(
      (data: string) => this.inputRouter.feed(data),
      () => this.handleResize(),
    );
    this.terminal.hideCursor();
    this.requestRender();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.renderer.setStopped(true);
    this.inputRouter.setStopped(true);

    this.renderer.moveCursorAfterRenderedContent();

    const t = this.terminal as StartableTerminal;
    t.stop?.();
    this.terminal.showCursor();
  }

  requestRender(force = false): void {
    this.renderer.requestRender(force);
  }

  addInputInterceptor(listener: (event: InputEvent) => boolean | undefined): () => void {
    return this.inputRouter.addInputInterceptor(listener);
  }

  private handleResize(): void {
    this.inputRouter.dispatchEvent({ type: 'resize', columns: this.terminal.columns, rows: this.terminal.rows });
    this.requestRender(true);
  }

  /**
   * Test-only seam used by `tui.test.ts` — delegates to {@link InputRouter}.
   * Kept on the class so existing `(tui as unknown as { dispatchEvent }).dispatchEvent(...)`
   * casts continue to work after the refactor.
   */
  private dispatchEvent(event: InputEvent): void {
    this.inputRouter.dispatchEvent(event);
  }

  /**
   * Test-only seam used by `tui.test.ts` — delegates to {@link Renderer}.
   * Kept on the class so existing `(tui as unknown as { doRender }).doRender()`
   * casts continue to work after the refactor.
   */
  private doRender(): void {
    this.renderer.doRender();
  }
}
