import type { LayoutStyle } from '../layout/types';
import type { Component } from '../types/component';

export interface BoxProps {
  layout?: LayoutStyle;
  children?: Component[];
}

/**
 * Transparent container. The layout engine handles its border / padding and
 * recurses into `children`. `Box.render()` returns no content lines.
 */
export class Box implements Component {
  layout?: LayoutStyle;
  children: Component[];

  constructor(props: BoxProps = {}) {
    this.layout = props.layout;
    this.children = props.children ?? [];
  }

  addChild(child: Component): void {
    this.children.push(child);
  }

  removeChild(child: Component): void {
    const index = this.children.indexOf(child);
    if (index !== -1) this.children.splice(index, 1);
  }

  render(): string[] {
    return [];
  }
}
