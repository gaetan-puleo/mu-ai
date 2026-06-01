import type { InputEvent } from './events';
import { InputRouter } from './inputRouter';
import type { GlobalKeybinding } from './keybinds';
import { colorToRgba, OPAQUE_BLACK, type Rgba } from './layout/color';
import { containsPoint } from './layout/insets';
import type { Color } from './layout/types';
import { type Command, commandPalette } from './components/command-palette';
import { Renderer } from './renderer';
import type { Component, SurfaceEntry } from './surface';
import type { Terminal } from './types/terminal';
import { modal, type ModalOptions, toast as toastView, type ToastKind } from './views';

export interface TuiOptions {
  synchronizedOutput?: boolean;
}

export interface LayerHandle {
  close(): void;
}

export interface ToastHandle {
  dismiss(): void;
}

interface LayerEntry {
  layer: Component;
  prevFocus: Component | null;
  onClose?: () => void;
}

interface ToastEntry {
  view: Component;
}

export class TUI {
  private root: Component | null = null;
  private focused: Component | null = null;
  private entries: SurfaceEntry[] = [];
  private backdrop: Rgba = OPAQUE_BLACK;
  private layers: LayerEntry[] = [];
  private toasts: ToastEntry[] = [];
  private escapeUnsub: (() => void) | undefined;
  private started = false;
  private terminalFocused = true;

  private readonly renderer: Renderer;
  private readonly inputRouter: InputRouter;

  constructor(private readonly terminal: Terminal, options: TuiOptions = {}) {
    this.renderer = new Renderer(
      terminal,
      {
        getRoot: () => this.composedRoot(),
        isFocused: (component) => component === this.focused && this.terminalFocused,
        setEntries: (entries) => {
          this.entries = entries;
        },
        getBackdropColor: () => this.backdrop,
      },
      options.synchronizedOutput ?? true,
    );

    this.inputRouter = new InputRouter({
      getFocused: () => this.focused,
      getEntries: () => this.entries,
      getTerminalFocused: () => this.terminalFocused,
      setTerminalFocused: (focused) => {
        this.terminalFocused = focused;
      },
      requestRender: (force) => this.requestRender(force),
    });
  }

  setRoot(component: Component | null): void {
    this.root = component;
    this.requestRender(true);
  }

  setBackgroundColor(color: Color): void {
    this.backdrop = { ...colorToRgba(color), a: 1 };
    this.requestRender(true);
  }

  setFocus(component: Component | null): void {
    this.focused = component;
    this.requestRender();
  }

  getFocused(): Component | null {
    return this.focused;
  }

  pushLayer(layer: Component, opts: { focus?: Component; onClose?: () => void } = {}): LayerHandle {
    const entry: LayerEntry = { layer, prevFocus: this.focused, onClose: opts.onClose };
    this.layers.push(entry);
    if (opts.focus) this.focused = opts.focus;
    if (!this.escapeUnsub) {
      this.escapeUnsub = this.addGlobalKeybinding({ chord: { key: 'escape' }, handler: () => this.popTopLayer() });
    }
    this.requestRender(true);
    return { close: () => this.removeLayer(entry) };
  }

  showModal(content: Component, opts: ModalOptions & { onClose?: () => void } = {}): LayerHandle {
    return this.pushLayer(modal(content, opts), { focus: content, onClose: opts.onClose });
  }

  showCommandPalette(commands: Command[]): LayerHandle {
    const ref: { handle?: LayerHandle } = {};
    const palette = commandPalette(commands, {
      onRun: (command) => {
        ref.handle?.close();
        command.run();
      },
    });
    ref.handle = this.pushLayer(palette, { focus: palette });
    return ref.handle;
  }

  toast(message: string, opts: { duration?: number; kind?: ToastKind } = {}): ToastHandle {
    const entry: ToastEntry = { view: toastView(message, { kind: opts.kind }) };
    this.toasts.push(entry);
    this.requestRender();
    const timer = setTimeout(() => this.dismissToast(entry), opts.duration ?? 3000);
    return {
      dismiss: () => {
        clearTimeout(timer);
        this.dismissToast(entry);
      },
    };
  }

  private dismissToast(entry: ToastEntry): void {
    const index = this.toasts.indexOf(entry);
    if (index === -1) return;
    this.toasts.splice(index, 1);
    this.requestRender();
  }

  private popTopLayer(): void {
    const top = this.layers[this.layers.length - 1];
    if (top) this.removeLayer(top);
  }

  private removeLayer(entry: LayerEntry): void {
    const index = this.layers.indexOf(entry);
    if (index === -1) return;
    this.layers.splice(index, 1);
    this.focused = entry.prevFocus;
    if (this.layers.length === 0 && this.escapeUnsub) {
      this.escapeUnsub();
      this.escapeUnsub = undefined;
    }
    entry.onClose?.();
    this.requestRender(true);
  }

  private composedRoot(): Component | null {
    if (this.layers.length === 0 && this.toasts.length === 0) return this.root;
    const root = this.root;
    const layers = this.layers;
    const toasts = this.toasts;
    return {
      render: (s) => {
        const full = { x: 0, y: 0, width: s.width, height: s.height };
        if (root) s.child(root, full);
        for (const entry of layers) s.child(entry.layer, full);

        let y = 0;
        for (const entry of toasts) {
          const w = Math.min(40, s.width);
          const h = s.measure(entry.view, w);
          if (y + h > s.height) break;
          s.child(entry.view, { x: s.width - w, y, width: w, height: h });
          y += h + 1;
        }
      },
    };
  }

  navigateFocus(direction: 'next' | 'previous'): Component | null {
    const focusables = this.entries.filter((entry) => entry.component.handleInput).map((entry) => entry.component);
    if (focusables.length === 0) return null;
    const current = this.focused ? focusables.indexOf(this.focused) : -1;
    const forward = direction === 'next';
    const next = forward ? (current + 1) % focusables.length : (current - 1 + focusables.length) % focusables.length;
    this.setFocus(focusables[next]);
    return focusables[next];
  }

  addGlobalKeybinding(binding: GlobalKeybinding): () => void {
    return this.inputRouter.addGlobalKeybinding(binding);
  }

  addInputInterceptor(listener: (event: InputEvent) => boolean | undefined): () => void {
    return this.inputRouter.addInputInterceptor(listener);
  }

  requestRender(force = false): void {
    this.renderer.requestRender(force);
  }

  renderNow(): void {
    this.renderer.doRender();
  }

  componentAt(x: number, y: number): Component | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (containsPoint(this.entries[i].rect, x, y)) return this.entries[i].component;
    }
    return null;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.renderer.setStopped(false);
    this.inputRouter.setStopped(false);
    this.terminal.start?.(
      (data) => this.inputRouter.feed(data),
      () => this.handleResize(),
    );
    this.terminal.hideCursor();
    this.requestRender(true);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.renderer.setStopped(true);
    this.inputRouter.setStopped(true);
    this.renderer.moveCursorAfterRenderedContent();
    this.terminal.stop?.();
    this.terminal.showCursor();
  }

  private handleResize(): void {
    this.requestRender(true);
  }
}
