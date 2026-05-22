import type { InputEvent } from '../events';
import { insetsForAxis, normalizeInsets } from '../layout/insets';
import type { Constraints, EventContext, LayoutStyle, Rect, RenderContext, Size } from '../layout/types';
import type { Component, Focusable } from '../types/component';

export interface ScrollViewProps {
  layout?: LayoutStyle;
  children?: Component[];
  /** Initial vertical scroll offset in cells. Default 0. */
  scrollY?: number;
  /** Whether the scroll view captures focus to handle keyboard scroll. */
  focusable?: boolean;
}

export interface SetScrollViewChildrenOptions {
  stickToBottom?: boolean;
}

/**
 * Vertical scroll container.
 *
 * Internal model:
 * - ScrollView owns one stable inner container ("content") of type
 *   `absolute` positioned at `(0, -scrollY)` within its content rect.
 * - User-provided children become the inner container's children and lay out
 *   normally (column direction by default).
 * - The layout engine clips the content to ScrollView's content rect via
 *   `overflow: 'scroll'`, producing a scrollable view.
 *
 * Scroll inputs (when focused):
 * - Wheel up / down adjust `scrollY` by one cell.
 * - Arrow up / down adjust by one cell.
 * - PageUp / PageDown adjust by the viewport height.
 * - Home / End jump to start / end of the content.
 *
 * v1 limitation: vertical scroll only.
 */
export class ScrollView implements Focusable {
  layout: LayoutStyle;
  focused = false;
  children: Component[];

  private _scrollY: number;
  private contentHeight = 0;
  private viewportHeight = 0;
  private viewportWidth = Number.POSITIVE_INFINITY;
  private pendingStickToBottom = false;
  private readonly inner: InnerContainer;

  constructor(props: ScrollViewProps = {}) {
    this.layout = { overflow: 'scroll', focusable: props.focusable ?? true, ...props.layout };
    this._scrollY = Math.max(0, props.scrollY ?? 0);
    this.inner = new InnerContainer(props.children ?? [], this._scrollY);
    this.children = [this.inner];
  }

  get scrollY(): number {
    return this._scrollY;
  }

  /** Replace the children of the inner content container. */
  setChildren(children: Component[], options: SetScrollViewChildrenOptions = {}): void {
    this.inner.setChildren(children);
    if (options.stickToBottom) this.pendingStickToBottom = true;
    this.refreshMetricsAndClamp();
    if (options.stickToBottom) this.applyPendingStickToBottom();
  }

  addChild(child: Component): void {
    this.inner.addChild(child);
    this.refreshMetricsAndClamp();
  }

  removeChild(child: Component): void {
    this.inner.removeChild(child);
    this.refreshMetricsAndClamp();
  }

  scrollBy(deltaY: number): void {
    this.scrollTo(this._scrollY + deltaY);
  }

  scrollTo(y: number): void {
    let next = Math.max(0, Math.floor(y));
    // Apply the contentHeight/viewportHeight clamp only when we have meaningful
    // measurements from a previous render. Otherwise the user's scroll target
    // is preserved and re-clamped on the next render via handleEvent.
    if (this.contentHeight > 0 && this.viewportHeight > 0) {
      const max = Math.max(0, this.contentHeight - this.viewportHeight);
      if (next > max) next = max;
    }
    this._scrollY = next;
    this.inner.setOffsetY(next);
  }

  isAtBottom(tolerance = 1): boolean {
    this.refreshMetricsAndClamp();
    const max = Math.max(0, this.contentHeight - this.viewportHeight);
    return this._scrollY >= max - tolerance;
  }

  scrollToBottom(): void {
    this.refreshMetricsAndClamp();
    this.scrollTo(this.contentHeight);
  }

  prepareLayout(contentRect: Rect): void {
    this.viewportWidth = contentRect.width;
    this.viewportHeight = contentRect.height;
    this.refreshMetricsAndClamp();
    this.applyPendingStickToBottom();
  }

  render(ctx?: RenderContext): string[] {
    if (ctx) {
      this.viewportWidth = ctx.contentRect.width;
      this.viewportHeight = ctx.contentRect.height;
    }
    this.refreshMetricsAndClamp();
    this.applyPendingStickToBottom();
    return [];
  }

  handleEvent(event: InputEvent, ctx: EventContext): void {
    this.viewportWidth = ctx.contentRect.width;
    this.viewportHeight = ctx.contentRect.height;
    this.refreshMetricsAndClamp();

    if (event.type === 'mouse' && event.kind === 'wheel') {
      if (event.button === 'wheelUp') this.scrollBy(-1);
      else if (event.button === 'wheelDown') this.scrollBy(1);
      return;
    }
    if (event.type !== 'key' || event.kind === 'release') return;

    switch (event.key) {
      case 'up':
        this.scrollBy(-1);
        return;
      case 'down':
        this.scrollBy(1);
        return;
      case 'pageUp':
        this.scrollBy(-Math.max(1, ctx.contentRect.height));
        return;
      case 'pageDown':
        this.scrollBy(Math.max(1, ctx.contentRect.height));
        return;
      case 'home':
        this.scrollTo(0);
        return;
      case 'end':
        this.scrollTo(this.contentHeight);
    }
  }

  private refreshMetricsAndClamp(): void {
    if (!Number.isFinite(this.viewportWidth) || this.viewportHeight <= 0) return;
    this.contentHeight = this.inner.measureNaturalHeight(this.viewportWidth);
    const max = Math.max(0, this.contentHeight - this.viewportHeight);
    if (this._scrollY > max) {
      this._scrollY = max;
      this.inner.setOffsetY(this._scrollY);
    }
  }

  private applyPendingStickToBottom(): void {
    if (!this.pendingStickToBottom) return;
    if (!Number.isFinite(this.viewportWidth) || this.viewportHeight <= 0) return;
    this.pendingStickToBottom = false;
    this.scrollTo(this.contentHeight);
  }
}

/**
 * Stable inner container used by ScrollView. It is positioned absolutely
 * inside the scroll view's content rect with `y = -offsetY`.
 */
class InnerContainer implements Component {
  layout: LayoutStyle;
  children: Component[];

  constructor(children: Component[], offsetY: number) {
    this.children = children;
    this.layout = {
      position: 'absolute',
      x: 0,
      y: -offsetY,
      width: 'fill',
      height: 'auto',
      direction: 'column',
    };
  }

  measure(_constraints: Constraints): Size {
    return {
      width: 0,
      height: this.measureNaturalHeight(),
    };
  }

  setOffsetY(y: number): void {
    this.layout = { ...this.layout, y: -y };
  }

  setChildren(children: Component[]): void {
    this.children = children;
  }

  addChild(child: Component): void {
    this.children.push(child);
  }

  removeChild(child: Component): void {
    const index = this.children.indexOf(child);
    if (index !== -1) this.children.splice(index, 1);
  }

  /**
   * Best-effort estimate of the natural content height: sum of children's
   * declared heights (numeric specs). Children without explicit heights
   * default to 1 line.
   */
  measureNaturalHeight(maxWidth = Number.POSITIVE_INFINITY): number {
    let total = 0;
    for (const child of this.children) {
      const margin = normalizeInsets(child.layout?.margin);
      const h = child.layout?.height;
      if (typeof h === 'number') total += h;
      else if (child.measure) {
        const size = child.measure({
          minWidth: 0,
          maxWidth,
          minHeight: 0,
          maxHeight: Number.POSITIVE_INFINITY,
        });
        total += size.height;
      } else {
        total += 1;
      }
      total += insetsForAxis(margin, 'height');
    }
    return total;
  }

  render(): string[] {
    return [];
  }
}
