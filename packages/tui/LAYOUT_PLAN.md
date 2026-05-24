# mu-tui Layout-Aware Framework Plan

## Goal

Turn `mu-tui` into a full X/Y layout-aware TUI framework with:

- recursive layout tree;
- `row`, `column`, `absolute`, and `overlay` positioning;
- hit testing by terminal `(x, y)`;
- clipping;
- padding, margin, and borders;
- z-index ordering;
- focus scopes;
- scroll containers;
- local mouse coordinates;
- compatibility decisions made explicitly before component work grows.

The target rendering pipeline is:

```text
Component tree
  -> layout pass
  -> render pass
  -> canvas composition
  -> differential terminal render
  -> hit-test table
  -> event routing
```

## Architecture Rule

Layout belongs in the `mu-tui` core, not in an optional feature.

Reason: layout controls core behavior:

- rendering;
- mouse hit testing;
- event dispatch;
- focus traversal;
- clipping;
- overlays;
- scroll views.

Rich terminal protocols remain optional features:

- images;
- OSC 52 clipboard;
- shell integration;
- terminfo probing.

## Target Structure

```text
packages/tui/src/
  layout/
    types.ts
    insets.ts
    engine.ts
    canvas.ts
    render.ts
    hitTest.ts

  components/
    Text.ts
    Box.ts
    Spacer.ts
    ScrollView.ts
    Button.ts
    Input.ts
    SelectList.ts
    index.ts

  capabilities.ts
  events.ts
  feature.ts
  keyboard.ts
  parser.ts
  protocol.ts
  terminal.ts
  tui.ts
  utils.ts
  index.ts
```

## Phase 1: Layout Types

Add `src/layout/types.ts`.

Core geometry:

```ts
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Constraints {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
}
```

Size specification:

```ts
export type SizeSpec = number | `${number}%` | `${number}fr` | 'auto' | 'fill';
```

Layout style:

```ts
export interface LayoutStyle {
  direction?: 'row' | 'column';
  position?: 'relative' | 'absolute' | 'overlay';

  x?: number;
  y?: number;

  width?: SizeSpec;
  height?: SizeSpec;

  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;

  margin?: number | Partial<Insets>;
  padding?: number | Partial<Insets>;

  border?: boolean | BorderStyle;

  zIndex?: number;
  overflow?: 'visible' | 'hidden' | 'scroll';

  focusable?: boolean;
  focusScope?: boolean;
}
```

Border style:

```ts
export interface BorderStyle {
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
  chars?: {
    horizontal: string;
    vertical: string;
    topLeft: string;
    topRight: string;
    bottomLeft: string;
    bottomRight: string;
  };
}
```

Render and event contexts:

```ts
export interface RenderContext {
  rect: Rect;
  contentRect: Rect;
  focused: boolean;
  capabilities: Capabilities;
}

export interface EventContext {
  rect: Rect;
  contentRect: Rect;
  localX?: number;
  localY?: number;
  focused: boolean;
}
```

Internal layout entry:

```ts
export interface LayoutEntry {
  component: Component;
  rect: Rect;
  contentRect: Rect;
  clipRect: Rect;
  zIndex: number;
  depth: number;
  order: number;
  parent?: Component;
}
```

## Phase 2: Component API

Update `src/types/component.ts`.

Target API:

```ts
export interface Component {
  layout?: LayoutStyle;
  children?: Component[];
  render: (ctx: RenderContext) => string[] | string;
  handleEvent?: (event: InputEvent, ctx: EventContext) => void;
  measure?: (constraints: Constraints) => Size;
  wantsKeyRelease?: boolean;
  invalidate?: () => void;
}
```

Recommended decision: make a clean breaking change now.

Current API:

```ts
render(width: number): string[];
handleEvent?(event: InputEvent): void;
```

Target API:

```ts
render(ctx: RenderContext): string[] | string;
handleEvent?(event: InputEvent, ctx: EventContext): void;
```

Reason to break now:

- less adapter complexity;
- clearer component authoring;
- layout-aware APIs from the start;
- `mu-tui` is still young and not broadly consumed.

## Phase 3: Insets And Rect Helpers

Add `src/layout/insets.ts`.

Required helpers:

```ts
normalizeInsets(input?: number | Partial<Insets>): Insets;
shrinkRect(rect: Rect, insets: Insets): Rect;
expandRect(rect: Rect, insets: Insets): Rect;
intersectRect(a: Rect, b: Rect): Rect;
containsPoint(rect: Rect, x: number, y: number): boolean;
isEmptyRect(rect: Rect): boolean;
```

Rules:

- `margin` reduces external allocated space;
- `border` consumes cells inside `rect`;
- `padding` reduces `contentRect`;
- all rects clamp to `width >= 0` and `height >= 0`.

## Phase 4: Layout Engine

Add `src/layout/engine.ts`.

Public API:

```ts
export function layoutTree(
  children: Component[],
  rootRect: Rect,
  focusedComponent: Component | null,
  capabilities: Capabilities,
): LayoutEntry[];
```

Internal pipeline:

```text
layoutTree
  -> layoutChildren
  -> layoutRelativeChildren
  -> layoutAbsoluteChildren
  -> computeBoxModel
  -> computeContentRect
  -> recurse into child containers
```

General rules:

- coordinates are zero-based;
- root rect is `{ x: 0, y: 0, width: columns, height: rows }`;
- relative children follow parent `direction`;
- `absolute` is relative to parent `contentRect`;
- `overlay` behaves like absolute but defaults to a higher `zIndex`;
- `overflow: hidden` clips to `contentRect`;
- `overflow: visible` still clips to root to avoid terminal corruption;
- `overflow: scroll` clips to `contentRect` and lets the component manage scroll state.

## Phase 5: Sizing Algorithm

For `row`:

- main axis: width;
- cross axis: height.

For `column`:

- main axis: height;
- cross axis: width.

Resolution order:

1. Normalize parent content rect.
2. Split children by `position`: relative vs absolute/overlay.
3. Resolve fixed sizes.
4. Resolve percentages.
5. Resolve `auto` via `measure()`.
6. Resolve `fr` from remaining space.
7. Resolve `fill` as `1fr` or full remaining space.
8. Apply min/max constraints.
9. Distribute any rounding delta.
10. Compute child positions.
11. Compute child `rect`, `contentRect`, and `clipRect`.
12. Recurse into child containers.

`SizeSpec` behavior:

- `number`: fixed cells;
- `50%`: percent of parent available space;
- `1fr`: fraction of remaining space;
- `auto`: use `component.measure()` if present, otherwise `0` on main axis;
- `fill`: behaves like `1fr` in groups, otherwise fills remaining space.

Avoid calling `render()` from layout measurement in the first implementation. It can create recursion and hidden performance costs.

## Phase 6: Canvas Composer

Add `src/layout/canvas.ts`.

API:

```ts
export interface Canvas {
  width: number;
  height: number;
  lines: string[];
}

export function createCanvas(width: number, height: number): Canvas;
export function drawLines(canvas: Canvas, x: number, y: number, lines: string[], clip: Rect): void;
export function drawBorder(canvas: Canvas, rect: Rect, border: BorderStyle | true): void;
export function canvasToLines(canvas: Canvas): string[];
```

First implementation can be line-string based.

Constraints:

- use `sliceByColumn` for horizontal clipping;
- use `visibleWidth` for padding;
- never produce a line wider than terminal width;
- reset styles at final TUI line level;
- accept imperfect overlapping ANSI behavior initially.

Known limitation: a line-based canvas cannot perfectly compose overlapping styled spans. A cell-based canvas can be added later.

## Phase 7: TUI Render Pipeline

Replace current `render(width)` in `src/tui.ts` with `renderFrame(width, height)`.

Target:

```ts
private layoutEntries: LayoutEntry[] = [];

private renderFrame(width: number, height: number): string[] {
  const rootRect = { x: 0, y: 0, width, height };

  const entries = layoutTree(
    this.children,
    rootRect,
    this.focusedComponent,
    this.capabilities,
  );

  this.layoutEntries = entries;

  const canvas = createCanvas(width, height);

  for (const entry of sortForRender(entries)) {
    drawEntry(canvas, entry);
  }

  return canvasToLines(canvas);
}
```

Render order:

1. lower `zIndex` first;
2. lower depth first;
3. insertion order as tie-breaker;
4. overlays above normal content.

## Phase 8: Entry Rendering

Add `src/layout/render.ts`.

API:

```ts
export function renderEntry(
  entry: LayoutEntry,
  focusedComponent: Component | null,
  capabilities: Capabilities,
): string[];
```

Steps:

1. Build `RenderContext`.
2. Call `component.render(ctx)`.
3. Normalize `string` to `string[]`.
4. Clip vertical output to `contentRect.height`.
5. Draw border if enabled.
6. Draw content into `contentRect`.

## Phase 9: Hit Testing

Add `src/layout/hitTest.ts`.

API:

```ts
export function hitTest(entries: LayoutEntry[], x: number, y: number): LayoutEntry | null;
```

Rules:

- sort by `zIndex` descending;
- tie-break by later render order;
- test `contentRect` first;
- later option: allow borders to be clickable by testing `rect`.

In `TUI`:

```ts
private getEntryAt(x: number, y: number): LayoutEntry | null {
  return hitTest(this.layoutEntries, x, y);
}
```

Mouse dispatch:

```ts
const entry = this.getEntryAt(event.x, event.y);
if (!entry) return;

const ctx = {
  rect: entry.rect,
  contentRect: entry.contentRect,
  localX: event.x - entry.contentRect.x,
  localY: event.y - entry.contentRect.y,
  focused: entry.component === this.focusedComponent,
};

entry.component.handleEvent?.(event, ctx);
```

## Phase 10: Event Routing

Rules:

- `mouse`: spatial target from hit testing;
- `key`: focused component;
- `text`: focused component;
- `paste`: focused component;
- `focus`: focused component plus listeners;
- `resize`: listeners plus rerender;
- features see events before components.

Keep raw input listeners separate for diagnostics/protocol features.

## Phase 11: Focus Scopes

Focus metadata:

```ts
interface FocusEntry {
  component: Component;
  rect: Rect;
  scope?: Component;
  order: number;
}
```

Build from `layoutEntries`:

- focusable if `layout.focusable === true` or `isFocusable(component)`;
- focus scope if `layout.focusScope === true`.

Initial traversal:

- `Tab`: next focusable in current scope;
- `Shift+Tab`: previous focusable in current scope;
- default order: layout order;
- overlays get priority when active.

Later traversal:

- arrow-key navigation by geometric proximity;
- explicit focus order;
- modal focus traps.

## Phase 12: ScrollView

Add `src/components/ScrollView.ts`.

State:

```ts
export class ScrollView implements Component {
  scrollX = 0;
  scrollY = 0;
}
```

Behavior:

- `layout.overflow = 'scroll'`;
- render only the visible window;
- wheel up/down adjusts `scrollY`;
- `PageUp`/`PageDown` works when focused;
- `Home`/`End` works when focused.

Methods:

```ts
scrollBy(deltaY: number): void;
scrollTo(y: number): void;
```

First version: vertical scroll only.

## Phase 13: Built-In Components

Add `src/components/Text.ts`.

```ts
interface TextProps {
  text: string;
  wrap?: boolean;
  layout?: LayoutStyle;
}
```

Responsibilities:

- render text into `ctx.contentRect.width`;
- optional wrapping;
- `measure()` returns natural size.

Add `src/components/Box.ts`.

```ts
interface BoxProps {
  layout?: LayoutStyle;
  children?: Component[];
}
```

`Box.render()` should return empty lines. Children are rendered by the layout engine, not by `Box` itself.

Add `src/components/Spacer.ts`.

```ts
interface SpacerProps {
  layout?: LayoutStyle;
}
```

Then add:

- `Button`;
- `Input`;
- `SelectList`;
- `ScrollView`.

## Phase 14: Container Handling

The layout engine should recurse into component children:

```ts
function getChildren(component: Component): Component[] {
  return Array.isArray(component.children) ? component.children : [];
}
```

Rules:

- root contains `TUI.children`;
- a `Box` contains its children;
- any component can technically be a container if it has `children`.

## Phase 15: Clipping

Vertical clipping:

- draw only lines where `globalY` is inside `clipRect`.

Horizontal clipping:

- use `sliceByColumn(line, start, end, true)`;
- pad after clipping if needed;
- avoid splitting wide characters.

Style safety:

- final TUI output appends reset per line;
- clipped ANSI lines should keep valid escape sequences.

## Phase 16: Borders

Default border characters:

```text
┌──┐
│  │
└──┘
```

Rules:

- top at `rect.y`;
- bottom at `rect.y + rect.height - 1`;
- left at `rect.x`;
- right at `rect.x + rect.width - 1`;
- border consumes one cell per enabled side;
- if width/height too small, degrade gracefully.

## Phase 17: Tests

Layout engine tests:

- row fixed + fr;
- row percent + fr;
- column fixed + auto;
- min/max constraints;
- padding reduces content rect;
- margin changes outer position;
- border reduces content rect;
- absolute child at x/y;
- overlay z-index above normal;
- nested `Box` layout.

Canvas tests:

- draw line at x/y;
- vertical clipping;
- horizontal clipping;
- border rendering;
- output line width safety;
- ANSI clipping preservation.

TUI tests:

- `renderFrame` creates full canvas lines;
- hit test returns component at `(x, y)`;
- overlap hit chooses higher z-index;
- mouse event includes `localX/localY`;
- key/text/paste goes to focused component;
- resize rerenders;
- overflow throws.

Component tests:

- `Text` wraps;
- `Box` lays out children;
- `Spacer` occupies space;
- `ScrollView` wheel updates scroll state.

## Phase 18: Exports

Update `packages/tui/package.json`:

```json
"exports": {
  ".": "./src/index.ts",
  "./features": "./src/features/index.ts",
  "./components": "./src/components/index.ts",
  "./layout": "./src/layout/index.ts"
}
```

Export policy:

- `mu-tui`: core TUI, events, capabilities, public types;
- `mu-tui/components`: built-in components;
- `mu-tui/layout`: advanced layout types and helpers;
- `mu-tui/features`: rich optional terminal features.

## Phase 19: Migration Strategy

Recommended: break API cleanly now.

Old:

```ts
render(width: number): string[];
handleEvent?(event: InputEvent): void;
```

New:

```ts
render(ctx: RenderContext): string[] | string;
handleEvent?(event: InputEvent, ctx: EventContext): void;
```

Reason:

- avoids fragile legacy adapters;
- makes every component layout-aware;
- simpler internal rendering;
- better typing for component authors.

## Phase 20: Risks And Mitigations

Risk: line-based canvas with ANSI overlap is imperfect.

Mitigation: reset at line boundaries and add ANSI clipping tests. Upgrade to cell-based canvas later if needed.

Risk: Unicode/wide chars still approximated.

Mitigation: continue using `visibleWidth` and `sliceByColumn(strict=true)`. Improve grapheme support later with `Intl.Segmenter`.

Risk: `auto` measurement can be expensive.

Mitigation: require `measure()` for meaningful auto sizing. Do not call `render()` from layout engine initially.

Risk: nested scrolling is complex.

Mitigation: first version supports vertical scroll only, owned by `ScrollView`.

Risk: focus scopes can grow complex.

Mitigation: start with layout-order traversal, add geometric navigation later.

## Execution Order

1. Add `layout/types.ts` and `layout/insets.ts`.
2. Add `layout/engine.ts` for row/column/fixed/fr/percent.
3. Add `layout/canvas.ts` with clipped drawing.
4. Update `Component` API to `render(ctx)` and `handleEvent(event, ctx)`.
5. Adapt `TUI` to `renderFrame(width, height)`.
6. Add `layoutEntries` and hit testing.
7. Add `Text`, `Box`, and `Spacer`.
8. Add layout/canvas/hit tests.
9. Add padding, margin, and border support.
10. Add absolute, overlay, and z-index support.
11. Add `ScrollView`.
12. Add focus traversal and focus scopes.
13. Add `./components` and `./layout` exports.
14. Run validation: `deno task test`, `deno task check`, `deno task lint`.

## Acceptance Criteria

The layout implementation is complete when:

- `Box row` places components side by side;
- `Box column` stacks components vertically;
- fixed, `%`, `fr`, `auto`, and `fill` sizes work;
- padding, margin, and border affect rects correctly;
- overlay can cover another component;
- topmost overlay receives mouse events first;
- a click at `(x, y)` routes to the correct component;
- components receive `localX/localY`;
- line overflow cannot corrupt terminal cursor state;
- `ScrollView` clips and scrolls with wheel events;
- focus traversal works in layout order;
- all tests, typecheck, and lint pass;
- rich terminal features remain decoupled from core layout.
