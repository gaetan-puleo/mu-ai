import type { LayoutEntry } from './layout/types';
import type { Component } from './types/component';
import { isFocusable } from './types/guards';

/**
 * Host interface for focus traversal. The TUI provides the latest layout
 * entries (post-render) and the top-level children fallback used before the
 * first render.
 */
export interface FocusHost {
  getLayoutEntries(): LayoutEntry[];
  getChildren(): Component[];
}

/**
 * Owns focused-component state and traversal across focusable components.
 */
export class FocusManager {
  private focusedComponent: Component | null = null;

  constructor(private readonly host: FocusHost) {}

  setFocus(component: Component | null): void {
    if (isFocusable(this.focusedComponent)) {
      this.focusedComponent.focused = false;
    }
    this.focusedComponent = component;
    if (isFocusable(component)) {
      component.focused = true;
    }
  }

  getFocused(): Component | null {
    return this.focusedComponent;
  }

  /**
   * Focusable components in layout order (depth, then insertion order).
   * Components with `layout.focusable === true` or implementing `Focusable`
   * are included.
   */
  private getFocusableComponents(): Component[] {
    return this.host
      .getLayoutEntries()
      .slice()
      .sort((a, b) => (a.depth !== b.depth ? a.depth - b.depth : a.order - b.order))
      .map((entry) => entry.component)
      .filter((c) => c.layout?.focusable === true || isFocusable(c));
  }

  /**
   * Focus traversal walks the flat focusable list from the layout pass.
   * Falls back to top-level children order when no layout entries exist
   * (e.g. before the first render).
   */
  navigateFocus(direction: 'up' | 'down' | 'left' | 'right'): Component | null {
    const focusables = this.getFocusableComponents();
    const pool = focusables.length > 0 ? focusables : this.host.getChildren();
    if (pool.length === 0) return null;

    const currentIndex = this.focusedComponent ? pool.indexOf(this.focusedComponent) : -1;
    const forward = direction === 'down' || direction === 'right';
    const nextIndex = forward ? (currentIndex + 1) % pool.length : (currentIndex - 1 + pool.length) % pool.length;

    const next = pool[nextIndex];
    this.setFocus(next);
    return next;
  }
}
