import type { InputEvent } from '../events';
import type { Component, Surface } from '../surface';

export interface ScrollViewOptions {
  wheelStep?: number;
  stickyHeader?: (info: { scrollY: number; width: number }) => Component | undefined;
  footer?: () => Component | undefined;
}

export class ScrollView implements Component {
  private scrollY = 0;
  private stick = true;
  private readonly wheelStep: number;
  private readonly stickyHeader?: (info: { scrollY: number; width: number }) => Component | undefined;
  private readonly footer?: () => Component | undefined;

  constructor(private content: Component, opts: ScrollViewOptions = {}) {
    this.wheelStep = Math.max(1, opts.wheelStep ?? 3);
    this.stickyHeader = opts.stickyHeader;
    this.footer = opts.footer;
  }

  atBottom(): boolean {
    return this.stick;
  }

  setContent(content: Component): void {
    this.content = content;
  }

  scrollToBottom(): void {
    this.stick = true;
  }

  render(s: Surface): void {
    const contentHeight = s.measure(this.content, s.width);
    if (Number.isFinite(s.height)) {
      const maxScroll = Math.max(0, contentHeight - s.height);
      if (!this.stick && this.scrollY >= maxScroll) this.stick = true;
      this.scrollY = this.stick ? maxScroll : Math.min(this.scrollY, maxScroll);
    }
    const scroll = Number.isFinite(s.height) ? this.scrollY : 0;
    s.child(this.content, { x: 0, y: -scroll, width: s.width, height: contentHeight });

    if (this.stickyHeader && Number.isFinite(s.height) && !this.stick) {
      const header = this.stickyHeader({ scrollY: this.scrollY, width: s.width });
      if (header) {
        const h = Math.min(s.measure(header, s.width), s.height);
        if (h > 0) s.child(header, { x: 0, y: 0, width: s.width, height: h });
      }
    }

    if (this.footer && Number.isFinite(s.height) && !this.stick) {
      const footer = this.footer();
      if (footer) {
        const h = Math.min(s.measure(footer, s.width), s.height);
        if (h > 0) s.child(footer, { x: 0, y: s.height - h, width: s.width, height: h });
      }
    }
  }

  handleInput(event: InputEvent): void {
    if (event.type === 'mouse' && event.kind === 'wheel') {
      if (event.button === 'wheelUp') this.scrollBy(-this.wheelStep);
      else if (event.button === 'wheelDown') this.scrollBy(this.wheelStep);
      return;
    }
    if (event.type !== 'key' || event.kind === 'release') return;
    if (event.key === 'up') this.scrollBy(-1);
    else if (event.key === 'down') this.scrollBy(1);
  }

  private scrollBy(delta: number): void {
    this.stick = false;
    this.scrollY = Math.max(0, this.scrollY + delta);
  }
}

export const scrollView = (content: Component, opts?: ScrollViewOptions): ScrollView => new ScrollView(content, opts);
