import type { Capabilities } from '../capabilities';
import type { Component } from '../types/component';

/** Axis-aligned rectangle in terminal cells. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Edge insets in cells. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Width/height pair in cells. */
export interface Size {
  width: number;
  height: number;
}

/** Sizing constraints, used by `measure()`. */
export interface Constraints {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
}

/**
 * A size specification for `width` / `height` in a `LayoutStyle`.
 *
 * - `number`: fixed cells.
 * - `'50%'`: percent of parent content available on this axis.
 * - `'1fr'`: fractional share of remaining space.
 * - `'auto'`: use the component's `measure()` (or 0 if none).
 * - `'fill'`: synonym for `'1fr'`; takes any remaining space.
 */
export type SizeSpec = number | `${number}%` | `${number}fr` | 'auto' | 'fill';

/**
 * Supported layout color values.
 *
 * - `#RGB`, `#RRGGBB`, `#RRGGBBAA`: truecolor with optional alpha
 * - Named ANSI 16 colors: emitted as indexed SGR (preserves terminal theming)
 * - `'default'`: terminal's configured default color, emitted as `CSI 39/49 m`
 */
export type Color =
  | `#${string}`
  | 'default'
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'brightBlack'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite';

/** Drawable border characters. */
export interface BorderChars {
  horizontal: string;
  vertical: string;
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
}

/** Border style with optional per-side enable flags. */
export interface BorderStyle {
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
  chars?: BorderChars;
}

/** Default Unicode box drawing characters. */
export const DEFAULT_BORDER_CHARS: BorderChars = {
  horizontal: '\u2500',
  vertical: '\u2502',
  topLeft: '\u250C',
  topRight: '\u2510',
  bottomLeft: '\u2514',
  bottomRight: '\u2518',
};

/** Layout style attached to a `Component`. */
export interface LayoutStyle {
  /** Children direction for relative children. Default `'column'`. */
  direction?: 'row' | 'column';
  /** Positioning relative to parent. Default `'relative'`. */
  position?: 'relative' | 'absolute' | 'overlay';
  /** Position x relative to parent content rect (only for absolute / overlay). */
  x?: number;
  /** Position y relative to parent content rect (only for absolute / overlay). */
  y?: number;
  /** Main-axis size for relative children, both axes for positioned children. */
  width?: SizeSpec;
  /** Cross-axis size for relative children, both axes for positioned children. */
  height?: SizeSpec;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** External space around the rect. Reduces parent's allocated slot. */
  margin?: number | Partial<Insets>;
  /** Internal space inside `rect`, shrinks `contentRect`. */
  padding?: number | Partial<Insets>;
  /** Border drawn on the boundary of `rect`. Consumes cells from `contentRect`. */
  border?: boolean | BorderStyle;
  /** Background color painted across the component's outer rect. */
  backgroundColor?: Color;
  /**
   * Background alpha, 0.0 (fully transparent) to 1.0 (opaque). Defaults to 1.
   * Use this with `backgroundColor` to produce a semi-transparent fill that
   * shows the underlying content through alpha compositing. Equivalent to
   * encoding alpha in an 8-digit `#RRGGBBAA` hex color.
   */
  backgroundOpacity?: number;
  /**
   * Whole-subtree opacity, 0.0-1.0. Multiplies with any ancestor opacity, so
   * nested containers compose: a parent at 0.5 with a child at 0.5 yields
   * 0.25 effective opacity for the child's drawing.
   */
  opacity?: number;
  /** Higher draws above lower. Default 0. Overlays default to 100. */
  zIndex?: number;
  /** Overflow handling for the component's content rect. Default `'visible'`. */
  overflow?: 'visible' | 'hidden' | 'scroll';
  /** Marks the component as focusable for Tab traversal. */
  focusable?: boolean;
  /** Marks the component as a focus scope boundary. */
  focusScope?: boolean;
}

/** Context passed to `Component.render`. */
export interface RenderContext {
  /** The full outer rect including border. */
  rect: Rect;
  /** The inner rect available for content. */
  contentRect: Rect;
  /** Whether the component currently holds focus. */
  focused: boolean;
  /** Negotiated terminal capabilities. */
  capabilities: Capabilities;
  /**
   * Application-defined context value. Set via `TuiOptions.userContext` /
   * `TUI.setUserContext()`. The TUI core treats this as opaque data; consumers
   * (e.g. a theme provider) cast it to their own type when reading it.
   */
  userContext?: unknown;
}

/** Context passed to `Component.handleEvent`. */
export interface EventContext {
  rect: Rect;
  contentRect: Rect;
  /** For mouse events: x relative to `contentRect.x`. */
  localX?: number;
  /** For mouse events: y relative to `contentRect.y`. */
  localY?: number;
  focused: boolean;
  /** Application-defined context value. See `RenderContext.userContext`. */
  userContext?: unknown;
}

/** Internal layout entry produced by the layout engine. */
export interface LayoutEntry {
  component: Component;
  rect: Rect;
  contentRect: Rect;
  clipRect: Rect;
  /** Resolved visual background, inherited from ancestors when not explicitly set. */
  backgroundColor?: Color;
  zIndex: number;
  depth: number;
  order: number;
  parent?: Component;
}
