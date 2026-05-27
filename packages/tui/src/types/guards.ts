import type { Component, Focusable } from './component';

export function isFocusable(component: Component | null): component is Component & Focusable {
  return component !== null && 'focused' in component;
}
