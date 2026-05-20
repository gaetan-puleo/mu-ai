import type { Component, Focusable, FocusableNavigation } from './component';

export function isFocusable(component: Component | null): component is Component & Focusable {
  return component !== null && 'focused' in component;
}

export function isFocusableNavigation(component: Component | null): component is FocusableNavigation {
  return component !== null && ('focusNext' in component || 'focusPrev' in component);
}
