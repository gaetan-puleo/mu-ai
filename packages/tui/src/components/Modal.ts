// biome-ignore-all lint/suspicious/noFocusedTests: `fit` is a terminal width helper, not a focused test call.
// biome-ignore-all lint/nursery/useConsistentTestIt: `fit` is a terminal width helper, not a test call.
import type { InputEvent } from '../events';
import type { Constraints, EventContext, LayoutStyle, Rect, RenderContext, Size } from '../layout/types';
import type { Component, Focusable } from '../types/component';
import { sliceByColumn, truncateToWidth, visibleWidth, wrapText } from '../utils';
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
  dimStyle?: string;
  panelStyle?: string;
  titleStyle?: string;
  bodyStyle?: string;
  footerStyle?: string;
}

const RESET = '\x1b[0m';
const DEFAULT_DIM_STYLE = '\x1b[40m';
const DEFAULT_PANEL_STYLE = '\x1b[48;2;24;24;24m';
const DEFAULT_TITLE_STYLE = '\x1b[1m\x1b[37m';
const DEFAULT_BODY_STYLE = '\x1b[37m';
const DEFAULT_FOOTER_STYLE = '\x1b[2m\x1b[37m';

/**
 * Full-screen modal overlay. Terminals do not support true alpha blending, so
 * the backdrop is rendered as dim dark cells to approximate transparency.
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
  private dimStyle: string;
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
    this.dimStyle = props.dimStyle ?? DEFAULT_DIM_STYLE;
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
    this.updateSlotLayout(this.panelRect);
  }

  private updateSlotLayout(panelRect: Rect): void {
    // The content slot sits inside the panel, leaving 1 row for title at the
    // top, 1 row for footer at the bottom, and 1 col padding on each side.
    if (!this.content) {
      // Collapse the slot to 0×0 so it doesn't intercept clicks.
      this.contentSlot.layout = { position: 'overlay', x: 0, y: 0, width: 0, height: 0 };
      return;
    }
    const innerX = panelRect.x + 1;
    const innerY = panelRect.y + 1;
    const innerWidth = Math.max(0, panelRect.width - 2);
    const innerHeight = Math.max(0, panelRect.height - 2);
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

    const lines = Array.from({ length: height }, () => `${this.dimStyle}${' '.repeat(width)}${RESET}`);
    // If prepareLayout hasn't run (e.g. component rendered standalone in a
    // test), compute the panel rect on the fly.
    const panel =
      this.panelRect.width > 0 && this.panelRect.height > 0 ? this.panelRect : this.computePanelRect(ctx.contentRect);
    if (panel.width <= 0 || panel.height <= 0) return lines;

    // panel is in absolute coords; convert to local for the rendered line buffer.
    const left = panel.x - ctx.contentRect.x;
    const top = panel.y - ctx.contentRect.y;
    const panelLines = this.panelLines(panel.width, panel.height);

    for (let i = 0; i < panelLines.length && top + i < lines.length; i++) {
      const row = top + i;
      if (row < 0) continue;
      lines[row] = replaceRange(lines[row], left, `${this.panelStyle}${panelLines[i]}${RESET}`, panel.width, width);
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
    const innerWidth = Math.max(0, width - 2);
    const lines: string[] = [];

    if (height > 0) lines.push(this.contentLine(this.title, innerWidth, this.titleStyle));

    const bodyHeight = Math.max(0, height - 2);
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

    if (height > 1) lines.push(this.contentLine(this.footer, innerWidth, this.footerStyle));

    return lines.slice(0, height);
  }

  private contentLine(text: string, width: number, style: string): string {
    const fitted = fit(text, width);
    return ` ${style}${fitted}${RESET} `;
  }

  private contentSurfaceLine(width: number): string {
    return ` ${' '.repeat(Math.max(0, width))} `;
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

function replaceRange(line: string, column: number, text: string, textWidth: number, totalWidth: number): string {
  const left = sliceByColumn(line, 0, column, true);
  const right = sliceByColumn(line, column + textWidth, totalWidth, true);
  const next = left + text + right;
  const nextWidth = visibleWidth(next);
  return nextWidth < totalWidth ? next + ' '.repeat(totalWidth - nextWidth) : next;
}
