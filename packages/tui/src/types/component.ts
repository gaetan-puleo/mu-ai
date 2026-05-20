import type { InputEvent } from '../events';
import type { Constraints, EventContext, LayoutStyle, RenderContext, Size } from '../layout/types';

/**
 * Component interface — all mu-tui components implement this.
 *
 * The layout engine reads `layout` and recurses into `children`. The render
 * pipeline calls `render(ctx)` to obtain content lines for the component's
 * `contentRect`. Mouse events are routed to the component whose rect contains
 * the click; key/text/paste events go to the focused component.
 */
export interface Component {
  /** Layout style — sizing, positioning, spacing, border, focus flags. */
  layout?: LayoutStyle;
  /** Child components managed by the layout engine. */
  children?: Component[];
  /**
   * Render the component's own content into `ctx.contentRect`. Must return an
   * array of lines where each line's visible width is ≤ `ctx.contentRect.width`.
   * Container-only components (Box, Spacer, ScrollView) return an empty array;
   * the layout engine handles their border and recurses into children.
   */
  render: (ctx: RenderContext) => string[];
  /**
   * Handle an input event delivered by the TUI router. Mouse events include
   * `localX` / `localY` (cell offsets into `contentRect`).
   */
  handleEvent?: (event: InputEvent, ctx: EventContext) => void;
  /**
   * Optional intrinsic-size hint, used by the layout engine to resolve
   * `width: 'auto'` / `height: 'auto'`. Must not call `render()`.
   */
  measure?: (constraints: Constraints) => Size;
  /** Whether this component receives key release events (Kitty protocol). */
  wantsKeyRelease?: boolean;
  /** Clear any internal cache before the next render. */
  invalidate?: () => void;
}

/** Components that can be focused and may show a text cursor. */
export interface Focusable extends Component {
  focused: boolean;
}

/** Components that manage their own children with arrow-key focus navigation. */
export interface FocusableNavigation extends Component {
  focusNext?: () => Component | null;
  focusPrev?: () => Component | null;
}

/**
 * Container-like helper — kept for backward compatibility with code that
 * conceptualizes a component as a "container" with focus management. The
 * layout engine now derives container behavior from `children` directly.
 */
export interface Container extends Component {
  children: Component[];
  addChild: (component: Component) => void;
  removeChild: (component: Component) => void;
  setFocus: (component: Component | null) => void;
  getFocused: () => Component | null;
  navigateFocus?: (direction: 'up' | 'down' | 'left' | 'right') => Component | null;
}
