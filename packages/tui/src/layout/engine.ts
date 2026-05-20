import type { Capabilities } from '../capabilities';
import type { Component } from '../types/component';
import { borderInsets, insetsForAxis, intersectRect, isEmptyRect, normalizeInsets, shrinkRect } from './insets';
import type { Constraints, LayoutEntry, LayoutStyle, Rect, Size, SizeSpec } from './types';

type Axis = 'width' | 'height';

interface BuildContext {
  rootRect: Rect;
  capabilities: Capabilities;
  focused: Component | null;
  entries: LayoutEntry[];
  order: { current: number };
}

/**
 * Build a flat list of layout entries from a component tree.
 *
 * - `rootRect` is `{ x: 0, y: 0, width: columns, height: rows }`.
 * - Returned entries include the root's children and all descendants.
 * - Order is insertion order (parents before children, relative before positioned).
 *   Use `sortForRender` to sort by zIndex/depth for drawing.
 */
export function layoutTree(
  children: Component[],
  rootRect: Rect,
  focused: Component | null,
  capabilities: Capabilities,
): LayoutEntry[] {
  const ctx: BuildContext = {
    rootRect,
    capabilities,
    focused,
    entries: [],
    order: { current: 0 },
  };

  layoutChildren(children, rootRect, rootRect, 'column', 0, undefined, ctx);
  return ctx.entries;
}

/**
 * Sort entries for rendering: lower zIndex first, then lower depth, then earlier order.
 * Drawing in this order ensures higher zIndex / deeper children paint on top.
 */
export function sortForRender(entries: LayoutEntry[]): LayoutEntry[] {
  return entries.slice().sort((a, b) => {
    if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.order - b.order;
  });
}

function layoutChildren(
  children: Component[],
  parentContentRect: Rect,
  parentClipRect: Rect,
  direction: 'row' | 'column',
  depth: number,
  parent: Component | undefined,
  ctx: BuildContext,
): void {
  if (children.length === 0) return;

  const relative: Component[] = [];
  const positioned: Component[] = [];
  for (const child of children) {
    const pos = child.layout?.position ?? 'relative';
    if (pos === 'relative') relative.push(child);
    else positioned.push(child);
  }

  layoutRelative(relative, parentContentRect, parentClipRect, direction, depth, parent, ctx);

  for (const child of positioned) {
    layoutPositioned(child, parentContentRect, parentClipRect, depth, parent, ctx);
  }
}

function layoutRelative(
  children: Component[],
  parentContentRect: Rect,
  parentClipRect: Rect,
  direction: 'row' | 'column',
  depth: number,
  parent: Component | undefined,
  ctx: BuildContext,
): void {
  if (children.length === 0) return;

  const mainAxis: Axis = direction === 'row' ? 'width' : 'height';
  const crossAxis: Axis = direction === 'row' ? 'height' : 'width';
  const mainTotal = direction === 'row' ? parentContentRect.width : parentContentRect.height;
  const crossTotal = direction === 'row' ? parentContentRect.height : parentContentRect.width;

  const outerSizes = distributeMainAxis(children, mainTotal, mainAxis, crossTotal);

  let cursor = direction === 'row' ? parentContentRect.x : parentContentRect.y;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const margin = normalizeInsets(child.layout?.margin);
    const outerMain = outerSizes[i];

    const innerCross = resolveCrossSize(child, crossAxis, crossTotal, margin);
    const outerCross = innerCross + insetsForAxis(margin, crossAxis);

    const slotRect: Rect =
      direction === 'row'
        ? {
            x: cursor,
            y: parentContentRect.y,
            width: outerMain,
            height: outerCross,
          }
        : {
            x: parentContentRect.x,
            y: cursor,
            width: outerCross,
            height: outerMain,
          };

    placeAndRegister(child, slotRect, parentClipRect, depth, parent, ctx);
    cursor += outerMain;
  }
}

function layoutPositioned(
  child: Component,
  parentContentRect: Rect,
  parentClipRect: Rect,
  depth: number,
  parent: Component | undefined,
  ctx: BuildContext,
): void {
  const margin = normalizeInsets(child.layout?.margin);
  const widthSpec: SizeSpec = child.layout?.width ?? 'auto';
  const heightSpec: SizeSpec = child.layout?.height ?? 'auto';

  const innerW = resolveAbsoluteAxis(
    widthSpec,
    parentContentRect.width,
    child,
    'width',
    insetsForAxis(margin, 'width'),
  );
  const innerH = resolveAbsoluteAxis(
    heightSpec,
    parentContentRect.height,
    child,
    'height',
    insetsForAxis(margin, 'height'),
  );

  const baseX = parentContentRect.x + (child.layout?.x ?? 0);
  const baseY = parentContentRect.y + (child.layout?.y ?? 0);

  const slotRect: Rect = {
    x: baseX,
    y: baseY,
    width: innerW + insetsForAxis(margin, 'width'),
    height: innerH + insetsForAxis(margin, 'height'),
  };

  placeAndRegister(child, slotRect, parentClipRect, depth, parent, ctx);
}

function placeAndRegister(
  child: Component,
  slotRect: Rect,
  parentClipRect: Rect,
  depth: number,
  parent: Component | undefined,
  ctx: BuildContext,
): void {
  const margin = normalizeInsets(child.layout?.margin);
  const rect = shrinkRect(slotRect, margin);
  const padding = normalizeInsets(child.layout?.padding);
  const border = borderInsets(child.layout?.border);
  const insidePadding = shrinkRect(rect, border);
  const contentRect = shrinkRect(insidePadding, padding);

  const overflow = child.layout?.overflow ?? 'visible';
  const ownClipRect = overflow === 'visible' ? ctx.rootRect : intersectRect(rect, ctx.rootRect);
  const clipRect = intersectRect(ownClipRect, parentClipRect);

  const positionMode = child.layout?.position ?? 'relative';
  const defaultZIndex = positionMode === 'overlay' ? 100 : 0;
  const zIndex = child.layout?.zIndex ?? defaultZIndex;

  const entry: LayoutEntry = {
    component: child,
    rect,
    contentRect,
    clipRect,
    zIndex,
    depth,
    order: ctx.order.current++,
    parent,
  };
  ctx.entries.push(entry);

  if (child.children && child.children.length > 0 && !isEmptyRect(contentRect)) {
    const childClipRect =
      overflow === 'hidden' || overflow === 'scroll' ? intersectRect(contentRect, clipRect) : clipRect;
    const childDirection = child.layout?.direction ?? 'column';
    layoutChildren(child.children, contentRect, childClipRect, childDirection, depth + 1, child, ctx);
  }
}

interface MainAxisPass {
  outer: number[];
  consumed: number;
  frTotal: number;
  frIdx: number[];
}

function distributeMainAxis(children: Component[], total: number, axis: Axis, crossTotal: number): number[] {
  const pass = computeFirstPass(children, total, axis, crossTotal);
  const remaining = Math.max(0, total - pass.consumed);
  if (pass.frTotal > 0 && pass.frIdx.length > 0) {
    distributeFractional(children, pass, remaining, axis);
  }
  return pass.outer;
}

function computeFirstPass(children: Component[], total: number, axis: Axis, crossTotal: number): MainAxisPass {
  const outer = new Array<number>(children.length).fill(0);
  const frIdx: number[] = [];
  let consumed = 0;
  let frTotal = 0;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const margin = insetsForAxis(normalizeInsets(child.layout?.margin), axis);
    const spec = mainSpec(child, axis);

    if (isFractionalSpec(spec)) {
      frTotal += specToFr(spec);
      frIdx.push(i);
      consumed += margin;
      continue;
    }

    const inner = resolveFixedSpec(spec, child, axis, total, crossTotal);
    outer[i] = inner + margin;
    consumed += outer[i];
  }

  return { outer, consumed, frTotal, frIdx };
}

function distributeFractional(children: Component[], pass: MainAxisPass, remaining: number, axis: Axis): void {
  let distributed = 0;
  for (const i of pass.frIdx) {
    const child = children[i];
    const spec = mainSpec(child, axis);
    const margin = insetsForAxis(normalizeInsets(child.layout?.margin), axis);
    const portion = Math.floor((remaining * specToFr(spec)) / pass.frTotal);
    const inner = clampAxis(portion, child, axis);
    pass.outer[i] = inner + margin;
    distributed += inner;
  }

  const delta = remaining - distributed;
  if (delta === 0) return;

  const last = pass.frIdx[pass.frIdx.length - 1];
  const child = children[last];
  const margin = insetsForAxis(normalizeInsets(child.layout?.margin), axis);
  const currentInner = pass.outer[last] - margin;
  pass.outer[last] = clampAxis(currentInner + delta, child, axis) + margin;
}

function mainSpec(child: Component, axis: Axis): SizeSpec {
  return (axis === 'width' ? child.layout?.width : child.layout?.height) ?? 'fill';
}

function isFractionalSpec(spec: SizeSpec): boolean {
  return spec === 'fill' || (typeof spec === 'string' && spec.endsWith('fr'));
}

function specToFr(spec: SizeSpec): number {
  if (spec === 'fill') return 1;
  if (typeof spec === 'string') return Number.parseFloat(spec) || 0;
  return 0;
}

function resolveFixedSpec(spec: SizeSpec, child: Component, axis: Axis, total: number, crossTotal: number): number {
  if (typeof spec === 'number') return clampAxis(spec, child, axis);
  if (typeof spec === 'string' && spec.endsWith('%')) {
    const pct = Number.parseFloat(spec) / 100;
    return clampAxis(Math.floor(total * pct), child, axis);
  }
  if (spec === 'auto') {
    return clampAxis(measureAxis(child, axis, crossTotal), child, axis);
  }
  return clampAxis(0, child, axis);
}

function resolveCrossSize(
  child: Component,
  axis: Axis,
  parentInner: number,
  margin = normalizeInsets(child.layout?.margin),
): number {
  const spec: SizeSpec = (axis === 'width' ? child.layout?.width : child.layout?.height) ?? 'fill';
  const available = Math.max(0, parentInner - insetsForAxis(margin, axis));

  let inner: number;
  if (typeof spec === 'number') {
    inner = spec;
  } else if (typeof spec === 'string' && spec.endsWith('%')) {
    const pct = Number.parseFloat(spec) / 100;
    inner = Math.floor(parentInner * pct);
  } else if (spec === 'auto') {
    inner = measureAxis(child, axis, available);
  } else {
    inner = available;
  }

  return clampAxis(Math.min(inner, available), child, axis);
}

function resolveAbsoluteAxis(
  spec: SizeSpec,
  parentInner: number,
  child: Component,
  axis: Axis,
  marginAxisTotal: number,
): number {
  const available = Math.max(0, parentInner - marginAxisTotal);
  let inner: number;
  if (typeof spec === 'number') {
    inner = spec;
  } else if (typeof spec === 'string' && spec.endsWith('%')) {
    const pct = Number.parseFloat(spec) / 100;
    inner = Math.floor(parentInner * pct);
  } else if (typeof spec === 'string' && spec.endsWith('fr')) {
    inner = available;
  } else if (spec === 'fill') {
    inner = available;
  } else {
    inner = measureAxis(child, axis, available);
  }

  return clampAxis(Math.min(inner, available), child, axis);
}

function measureAxis(child: Component, axis: Axis, crossAvailable: number): number {
  if (!child.measure) return 0;
  const constraints: Constraints = {
    minWidth: 0,
    maxWidth: axis === 'width' ? Number.POSITIVE_INFINITY : crossAvailable,
    minHeight: 0,
    maxHeight: axis === 'height' ? Number.POSITIVE_INFINITY : crossAvailable,
  };
  const size: Size = child.measure(constraints);
  return axis === 'width' ? size.width : size.height;
}

function clampAxis(value: number, child: Component, axis: Axis): number {
  const layout: LayoutStyle | undefined = child.layout;
  const min = axis === 'width' ? layout?.minWidth : layout?.minHeight;
  const max = axis === 'width' ? layout?.maxWidth : layout?.maxHeight;
  let v = Math.max(0, Math.floor(value));
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}
