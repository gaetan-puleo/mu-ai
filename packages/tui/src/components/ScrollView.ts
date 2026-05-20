import type { InputEvent } from '../events';
import type { EventContext, LayoutStyle } from '../layout/types';
import type { Component, Focusable } from '../types/component';

export interface ScrollViewProps {
  layout?: LayoutStyle;
  children?: Component[];
  /** Initial vertical scroll offset in cells. Default 0. */
  scrollY?: number;
  /** Whether the scroll view captures focus to handle keyboard scroll. */
  focusable?: boolean;
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
  setChildren(children: Component[]): void {
    this.inner.setChildren(children);
  }

  addChild(child: Component): void {
    this.inner.addChild(child);
  }

  removeChild(child: Component): void {
    this.inner.removeChild(child);
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

  render(): string[] {
    return [];
  }

  handleEvent(event: InputEvent, ctx: EventContext): void {
    this.viewportHeight = ctx.contentRect.height;
    this.contentHeight = this.inner.measureNaturalHeight();

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
      direction: 'column',
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
  measureNaturalHeight(): number {
    let total = 0;
    for (const child of this.children) {
      const h = child.layout?.height;
      if (typeof h === 'number') total += h;
      else if (child.measure) {
        const size = child.measure({
          minWidth: 0,
          maxWidth: Number.POSITIVE_INFINITY,
          minHeight: 0,
          maxHeight: Number.POSITIVE_INFINITY,
        });
        total += size.height;
      } else {
        total += 1;
      }
    }
    return total;
  }

  render(): string[] {
    return [];
  }
}
