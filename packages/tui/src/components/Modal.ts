import type { InputEvent } from '../events';
import type { Constraints, EventContext, LayoutStyle, Rect, RenderContext, Size } from '../layout/types';
import type { Component, Focusable } from '../types/component';
import { truncateToWidth, visibleWidth, wrapText } from '../utils';
import { Box } from './Box';

export interface ModalProps {
  title?: string;
  body?: string | string[];
  /** A child component rendered inside the panel body. Overrides `body` when set. */
  content?: Component;
  footer?: string;
  layout?: LayoutStyle;
  width?: number;
  height?: number;
  onClose?: () => void;
  /**
   * Backdrop color (overlay outside the panel). Defaults to `'#000000'` with
   * `backdropOpacity = 0.5`, producing a real semi-transparent darken — the
   * content underneath the modal shows through, blended.
   */
  backdropColor?: string;
  /** Backdrop opacity, 0.0-1.0. Defaults to 0.5. */
  backdropOpacity?: number;
  panelStyle?: string;
  titleStyle?: string;
  bodyStyle?: string;
  footerStyle?: string;
}

const RESET = '\x1b[0m';
const DEFAULT_BACKDROP_COLOR = '#000000';
const DEFAULT_BACKDROP_OPACITY = 0.7;
const DEFAULT_PANEL_STYLE = '\x1b[48;2;24;24;24m';
const DEFAULT_TITLE_STYLE = '\x1b[1m\x1b[37m';
const DEFAULT_BODY_STYLE = '\x1b[37m';
const DEFAULT_FOOTER_STYLE = '\x1b[2m\x1b[37m';

/**
 * Full-screen modal overlay.
 *
 * The backdrop uses real alpha compositing: the framework blends a
 * semi-transparent dark fill over whatever is underneath, so the modal acts
 * like a translucent panel rather than an opaque dim layer. Customize via
 * `backdropColor` and `backdropOpacity`.
 *
 * Two body modes:
 * - `body: string | string[]` — Modal renders the text itself.
 * - `content: Component` — Modal positions the child in the panel's body area
 *   so it can receive its own mouse/key events.
 */
export class Modal implements Focusable {
  layout: LayoutStyle;
  focused = false;
  children: Component[];

  private title: string;
  private body: string[];
  private content: Component | undefined;
  private footer: string;
  private widthPref?: number;
  private heightPref?: number;
  private onClose?: () => void;
  private panelStyle: string;
  private titleStyle: string;
  private bodyStyle: string;
  private footerStyle: string;

  /** Internal slot that hosts the content child inside the panel body rect. */
  private contentSlot: Box;
  /** Last computed panel rect (set in prepareLayout, read in render). */
  private panelRect: Rect = { x: 0, y: 0, width: 0, height: 0 };

  constructor(props: ModalProps = {}) {
    this.title = props.title ?? '';
    this.body = normalizeBody(props.body);
    this.content = props.content;
    this.footer = props.footer ?? 'Esc to close';
    this.widthPref = props.width;
    this.heightPref = props.height;
    this.onClose = props.onClose;
    this.panelStyle = props.panelStyle ?? DEFAULT_PANEL_STYLE;
    this.titleStyle = props.titleStyle ?? DEFAULT_TITLE_STYLE;
    this.bodyStyle = props.bodyStyle ?? DEFAULT_BODY_STYLE;
    this.footerStyle = props.footerStyle ?? DEFAULT_FOOTER_STYLE;
    this.layout = {
      position: 'overlay',
      x: 0,
      y: 0,
      width: 'fill',
      height: 'fill',
      focusable: true,
      zIndex: 1000,
      backgroundColor: props.backdropColor ?? DEFAULT_BACKDROP_COLOR,
      backgroundOpacity: props.backdropOpacity ?? DEFAULT_BACKDROP_OPACITY,
      ...props.layout,
    };

    this.contentSlot = new Box({
      layout: { position: 'overlay', x: 0, y: 0, width: 0, height: 0 },
      children: this.content ? [this.content] : [],
    });
    this.children = [this.contentSlot];
  }

  setContent(props: Pick<ModalProps, 'title' | 'body' | 'footer' | 'content'>): void {
    if (props.title !== undefined) this.title = props.title;
    if (props.body !== undefined) this.body = normalizeBody(props.body);
    if (props.footer !== undefined) this.footer = props.footer;
    if (props.content !== undefined) {
      this.content = props.content;
      this.contentSlot.children = [this.content];
    }
  }

  setContentComponent(component: Component | undefined): void {
    this.content = component;
    this.contentSlot.children = component ? [component] : [];
  }

  /** Override the panel's preferred width/height. Pass undefined to clear. */
  setSize(width: number | undefined, height: number | undefined): void {
    this.widthPref = width;
    this.heightPref = height;
  }

  prepareLayout(contentRect: Rect): void {
    this.panelRect = this.computePanelRect(contentRect);
    this.updateSlotLayout(this.panelRect, contentRect);
  }

  private updateSlotLayout(panelRect: Rect, parentRect: Rect): void {
    if (!this.content) {
      this.contentSlot.layout = { position: 'overlay', x: 0, y: 0, width: 0, height: 0 };
      return;
    }
    const innerX = panelRect.x - parentRect.x + 2;
    const innerY = panelRect.y - parentRect.y + 2;
    const innerWidth = Math.max(0, panelRect.width - 4);
    const innerHeight = Math.max(0, panelRect.height - 4);
    this.contentSlot.layout = {
      position: 'overlay',
      x: innerX,
      y: innerY,
      width: innerWidth,
      height: innerHeight,
    };
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    // The semi-transparent backdrop is painted by the framework via
    // layout.backgroundColor + backgroundOpacity. Here we only need to
    // emit the opaque panel rows; non-panel rows are returned as empty
    // strings so the backdrop shows through unchanged.
    const lines: string[] = new Array(height).fill('');

    const panel = this.panelRect.width > 0 && this.panelRect.height > 0
      ? this.panelRect
      : this.computePanelRect(ctx.contentRect);
    if (panel.width <= 0 || panel.height <= 0) return lines;

    const left = panel.x - ctx.contentRect.x;
    const top = panel.y - ctx.contentRect.y;
    const panelLines = this.panelLines(panel.width, panel.height);

    for (let i = 0; i < panelLines.length && top + i < lines.length; i++) {
      const row = top + i;
      if (row < 0) continue;
      // Pad to the panel's column offset so the panel sits at the right
      // absolute column when composited onto the buffer row.
      const leftPad = left > 0 ? ' '.repeat(left) : '';
      lines[row] = `${leftPad}${this.panelStyle}${panelLines[i]}${RESET}`;
    }

    return lines;
  }

  private computePanelRect(contentRect: Rect): Rect {
    const { width, height } = contentRect;
    if (width <= 0 || height <= 0) return { x: 0, y: 0, width: 0, height: 0 };
    const panelWidth = clamp(this.widthPref ?? Math.min(72, Math.max(24, width - 8)), 8, width);
    // Default panel height: enough for the body + title + footer + a little
    // breathing room. For component content (no string body), pick a small
    // sensible default — callers should pass `height` for precise sizing.
    const bodyLines = this.content ? 8 : this.body.length;
    const bodyHeightHint = Math.max(5, bodyLines + 4);
    const panelHeight = clamp(this.heightPref ?? Math.min(height - 2, bodyHeightHint), 3, height);
    const left = contentRect.x + Math.max(0, Math.floor((width - panelWidth) / 2));
    const top = contentRect.y + Math.max(0, Math.floor((height - panelHeight) / 2));
    return { x: left, y: top, width: panelWidth, height: panelHeight };
  }

  measure(constraints: Constraints): Size {
    return {
      width: Number.isFinite(constraints.maxWidth) ? constraints.maxWidth : (this.widthPref ?? 72),
      height: Number.isFinite(constraints.maxHeight)
        ? constraints.maxHeight
        : (this.heightPref ?? Math.max(5, this.body.length + 4)),
    };
  }

  handleEvent(event: InputEvent, _ctx: EventContext): void {
    if (event.type === 'key' && event.kind !== 'release' && (event.key === 'escape' || event.key === 'esc')) {
      this.onClose?.();
    }
  }

  private panelLines(width: number, height: number): string[] {
    if (width <= 0) return [];
    const innerWidth = Math.max(0, width - 4);
    const lines: string[] = [];

    if (height > 0) lines.push(this.contentSurfaceLine(innerWidth));
    if (height > 1) lines.push(this.contentLine(this.title, innerWidth, this.titleStyle));

    const bodyHeight = Math.max(0, height - 4);
    if (this.content) {
      // Reserve neutral panel rows for the content child. Do not wrap these
      // blanks in body text styles: the child is painted on top as a separate
      // layout entry, and parent foreground resets can make overlaid text
      // invisible in some terminals.
      for (let i = 0; i < bodyHeight; i++) {
        lines.push(this.contentSurfaceLine(innerWidth));
      }
    } else {
      const wrappedBody = this.body.flatMap((line) => wrapText(line, innerWidth));
      for (let i = 0; i < bodyHeight; i++) {
        lines.push(this.contentLine(wrappedBody[i] ?? '', innerWidth, this.bodyStyle));
      }
    }

    if (height > 2) lines.push(this.contentLine(this.footer, innerWidth, this.footerStyle));
    if (height > 3) lines.push(this.contentSurfaceLine(innerWidth));

    return lines.slice(0, height);
  }

  private contentLine(text: string, width: number, style: string): string {
    const fitted = fit(text, width);
    return `  ${style}${fitted}${RESET}${this.panelStyle}  `;
  }

  private contentSurfaceLine(width: number): string {
    return `  ${' '.repeat(Math.max(0, width))}  `;
  }
}

function normalizeBody(body: string | string[] | undefined): string[] {
  if (Array.isArray(body)) return body;
  if (body === undefined || body.length === 0) return [];
  return body.split('\n');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function fit(value: string, width: number): string {
  if (width <= 0) return '';
  const truncated = visibleWidth(value) > width ? truncateToWidth(value, width) : value;
  const padding = width - visibleWidth(truncated);
  return padding > 0 ? truncated + ' '.repeat(padding) : truncated;
}

