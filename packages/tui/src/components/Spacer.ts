import type { LayoutStyle } from '../layout/types';
import type { Component } from '../types/component';

export interface SpacerProps {
  layout?: LayoutStyle;
}

/**
 * Empty filler. Defaults to `width: 'fill'` and `height: 'fill'` so it can
 * push siblings to the edges of a row or column when no explicit size is set.
 */
export class Spacer implements Component {
  layout?: LayoutStyle;

  constructor(props: SpacerProps = {}) {
    this.layout = { width: 'fill', height: 'fill', ...props.layout };
  }

  render(): string[] {
    return [];
  }
}
