import { borderInsets, insetsForAxis, normalizeInsets } from '../layout/insets';
import type { Constraints, LayoutStyle, Size } from '../layout/types';
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

  measure(constraints: Constraints): Size {
    const padding = normalizeInsets(this.layout?.padding);
    const border = borderInsets(this.layout?.border);
    const insetWidth = insetsForAxis(padding, 'width') + insetsForAxis(border, 'width');
    const insetHeight = insetsForAxis(padding, 'height') + insetsForAxis(border, 'height');
    const childConstraints: Constraints = {
      minWidth: 0,
      maxWidth: Math.max(0, constraints.maxWidth - insetWidth),
      minHeight: 0,
      maxHeight: Math.max(0, constraints.maxHeight - insetHeight),
    };
    const direction = this.layout?.direction ?? 'column';

    let width = 0;
    let height = 0;
    for (const child of this.children) {
      const size = measureChild(child, childConstraints);
      if (direction === 'row') {
        width += size.width;
        height = Math.max(height, size.height);
      } else {
        width = Math.max(width, size.width);
        height += size.height;
      }
    }

    return { width: width + insetWidth, height: height + insetHeight };
  }

  render(): string[] {
    return [];
  }
}

function measureChild(child: Component, constraints: Constraints): Size {
  if (child.measure) return child.measure(constraints);
  const width = typeof child.layout?.width === 'number' ? child.layout.width : 0;
  const height = typeof child.layout?.height === 'number' ? child.layout.height : 1;
  return { width, height };
}
