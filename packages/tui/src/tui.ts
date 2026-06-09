import { copyToClipboard } from './clipboard';
import type { InputEvent } from './events';
import { InputRouter } from './inputRouter';
import type { GlobalKeybinding } from './keybinds';
import type { CellBuffer } from './layout/cellbuffer';
import { colorToRgba, OPAQUE_BLACK, type Rgba } from './layout/color';
import { highlightSelection, orderPoints, type Point, selectedText } from './selection';
import { containsPoint } from './layout/insets';
import type { Color } from './layout/types';
import { type Command, commandPalette } from './components/command-palette';
import { Renderer } from './renderer';
import type { Component, SurfaceEntry } from './surface';
import type { Terminal } from './types/terminal';
import { modal, type ModalOptions, toast as toastView, type ToastKind, toastWidth } from './views';

export interface TuiOptions {
  synchronizedOutput?: boolean;
  textSelection?: boolean;
}

interface Selection {
  anchor: Point;
  head: Point;
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
  width: number;
}

export class TUI {
  private root: Component | null = null;
  private focused: Component | null = null;
  private entries: SurfaceEntry[] = [];
  private backdrop: Rgba = OPAQUE_BLACK;
  private layers: LayerEntry[] = [];
  private toasts: ToastEntry[] = [];
  private toastBackground: Color | undefined;
  private toastForeground: Color | undefined;
  private escapeUnsub: (() => void) | undefined;
  private started = false;
  private terminalFocused = true;

  private lastBuffer: CellBuffer | null = null;
  private selectAnchor: Point | null = null;
  private selection: Selection | null = null;

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
        decorateBuffer: (buffer) => this.decorateBuffer(buffer),
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

    if (options.textSelection ?? true) {
      this.inputRouter.addInputInterceptor((event) => this.handleSelectionInput(event));
    }
  }

  setRoot(component: Component | null): void {
    this.root = component;
    this.requestRender(true);
  }

  setBackgroundColor(color: Color): void {
    this.backdrop = { ...colorToRgba(color), a: 1 };
    this.requestRender(true);
  }

  setToastBackground(color: Color): void {
    this.toastBackground = color;
  }

  setToastForeground(color: Color): void {
    this.toastForeground = color;
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
    const entry: ToastEntry = {
      view: toastView(message, {
        kind: opts.kind,
        background: this.toastBackground,
        foreground: this.toastForeground,
      }),
      width: toastWidth(message, opts),
    };
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

        const margin = s.width > 2 ? 1 : 0;
        let y = margin;
        for (const entry of toasts) {
          const w = Math.max(1, Math.min(entry.width, s.width - margin));
          const h = s.measure(entry.view, w);
          if (y + h > s.height) break;
          s.child(entry.view, { x: s.width - w - margin, y, width: w, height: h });
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

  private handleSelectionInput(event: InputEvent): boolean | undefined {
    if (event.type !== 'mouse') return undefined;
    if (event.kind === 'press' && event.button === 'left') {
      this.selectAnchor = { x: event.x, y: event.y };
      if (this.selection) {
        this.selection = null;
        this.requestRender();
      }
      return undefined;
    }
    if (event.kind === 'drag' && this.selectAnchor) {
      const head = { x: event.x, y: event.y };
      if (!this.selection && head.x === this.selectAnchor.x && head.y === this.selectAnchor.y) return true;
      this.selection = { anchor: this.selectAnchor, head };
      this.requestRender();
      return true;
    }
    if (event.kind === 'release') {
      const had = this.selection !== null;
      const text = had ? this.extractSelection() : '';
      this.selectAnchor = null;
      if (had) {
        this.selection = null;
        this.requestRender();
        if (text.trim().length > 0) {
          copyToClipboard(this.terminal, text);
          this.toast('Copied to clipboard', { kind: 'success' });
        }
        return true;
      }
      return undefined;
    }
    return undefined;
  }

  private decorateBuffer(buffer: CellBuffer): void {
    this.lastBuffer = buffer;
    if (!this.selection) return;
    const { start, end } = orderPoints(this.selection.anchor, this.selection.head);
    highlightSelection(buffer, start, end);
  }

  private extractSelection(): string {
    if (!this.lastBuffer || !this.selection) return '';
    const { start, end } = orderPoints(this.selection.anchor, this.selection.head);
    return selectedText(this.lastBuffer, start, end);
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
