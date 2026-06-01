import type { InputEvent } from '../events';
import type { Component, Surface } from '../surface';

export class ScrollView implements Component {
  private scrollY = 0;
  private stick = true;

  constructor(private content: Component) {}

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
  }

  handleInput(event: InputEvent): void {
    if (event.type === 'mouse' && event.kind === 'wheel') {
      if (event.button === 'wheelUp') this.scrollBy(-1);
      else if (event.button === 'wheelDown') this.scrollBy(1);
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

export const scrollView = (content: Component): ScrollView => new ScrollView(content);
