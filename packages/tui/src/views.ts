import { type Color, DEFAULT_BORDER_CHARS } from './layout/types';
import { type Component, measureWidth, type Surface } from './surface';
import { wrapText } from './utils';

export const text = (value: string): Component => ({
  render: (s) => {
    const lines = wrapText(value, s.width);
    for (let i = 0; i < lines.length && i < s.height; i++) s.text(0, i, lines[i]);
  },
});

export interface FlexItem {
  readonly flex: number;
  readonly component: Component;
}

export const flex = (component: Component, weight = 1): FlexItem => ({ flex: weight, component });

const isFlex = (item: Component | FlexItem): item is FlexItem => 'flex' in item;

const distributeFlex = (children: (Component | FlexItem)[], sizes: number[], remaining: number): void => {
  const totalFlex = children.reduce((sum, item) => (isFlex(item) ? sum + item.flex : sum), 0);
  if (totalFlex === 0) return;
  const flexIndices = children.flatMap((item, i) => (isFlex(item) ? [i] : []));
  let used = 0;
  flexIndices.forEach((index, k) => {
    const item = children[index] as FlexItem;
    const last = k === flexIndices.length - 1;
    sizes[index] = Math.max(0, last ? remaining - used : Math.floor((remaining * item.flex) / totalFlex));
    used += sizes[index];
  });
};

export const column = (children: (Component | FlexItem)[]): Component => ({
  render: (s) => {
    const sizes = children.map((item) => (isFlex(item) ? -1 : s.measure(item, s.width)));
    const usedAuto = sizes.reduce((sum, h) => (h >= 0 ? sum + h : sum), 0);
    distributeFlex(children, sizes, Math.max(0, s.height - usedAuto));

    let y = 0;
    for (let i = 0; i < children.length; i++) {
      const item = children[i];
      const component = isFlex(item) ? item.component : item;
      if (sizes[i] > 0) s.child(component, { x: 0, y, width: s.width, height: sizes[i] });
      y += sizes[i];
    }
  },
});

export const row = (children: (Component | FlexItem)[]): Component => ({
  render: (s) => {
    const sizes = children.map((item) => (isFlex(item) ? -1 : measureWidth(item, s.width)));
    const usedAuto = sizes.reduce((sum, w) => (w >= 0 ? sum + w : sum), 0);
    distributeFlex(children, sizes, Math.max(0, s.width - usedAuto));

    let x = 0;
    for (let i = 0; i < children.length; i++) {
      const item = children[i];
      const component = isFlex(item) ? item.component : item;
      if (sizes[i] > 0) s.child(component, { x, y: 0, width: sizes[i], height: s.height });
      x += sizes[i];
    }
  },
});

export interface BoxOptions {
  border?: boolean;
  background?: Color;
  backgroundOpacity?: number;
  padding?: number;
}

const drawBorder = (s: Surface, height: number): void => {
  const w = s.width;
  if (w < 2 || height < 2) return;
  const c = DEFAULT_BORDER_CHARS;
  s.text(0, 0, c.topLeft + c.horizontal.repeat(w - 2) + c.topRight);
  for (let y = 1; y < height - 1; y++) {
    s.text(0, y, c.vertical);
    s.text(w - 1, y, c.vertical);
  }
  s.text(0, height - 1, c.bottomLeft + c.horizontal.repeat(w - 2) + c.bottomRight);
};

export const box = (child: Component, opts: BoxOptions = {}): Component => ({
  render: (s) => {
    const inset = (opts.border ? 1 : 0) + (opts.padding ?? 0);
    const innerW = Math.max(0, s.width - 2 * inset);
    const contentH = s.measure(child, innerW);
    const selfH = Math.min(contentH + 2 * inset, s.height);

    if (opts.background) {
      s.fill({ x: 0, y: 0, width: s.width, height: selfH }, opts.background, opts.backgroundOpacity);
    }
    if (opts.border) drawBorder(s, selfH);

    const innerH = Math.max(0, selfH - 2 * inset);
    if (innerW > 0 && innerH > 0) s.child(child, { x: inset, y: inset, width: innerW, height: innerH });
  },
});

export interface OverlayOptions {
  width?: number;
  opacity?: number;
}

export const overlay = (background: Component, panel: Component, opts: OverlayOptions = {}): Component => ({
  render: (s) => {
    s.child(background, { x: 0, y: 0, width: s.width, height: s.height });
    s.fill({ x: 0, y: 0, width: s.width, height: s.height }, '#000000', opts.opacity ?? 0.6);

    const w = Math.min(opts.width ?? 60, s.width);
    const h = Math.min(s.measure(panel, w), s.height);
    const x = Math.max(0, Math.floor((s.width - w) / 2));
    const y = Math.max(0, Math.floor((s.height - h) / 2));
    s.child(panel, { x, y, width: w, height: h });
  },
});

export interface ModalOptions {
  title?: string;
  width?: number;
  opacity?: number;
  border?: boolean;
  background?: Color;
}

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
}

const TOAST_BACKGROUND: Record<ToastKind, Color> = {
  info: '#1e3a5f',
  success: '#1e4620',
  error: '#5f1e1e',
};

export const toast = (message: string, opts: ToastOptions = {}): Component =>
  box(text(message), { border: true, background: TOAST_BACKGROUND[opts.kind ?? 'info'], padding: 0 });

export const modal = (content: Component, opts: ModalOptions = {}): Component => ({
  render: (s) => {
    s.fill({ x: 0, y: 0, width: s.width, height: s.height }, '#000000', opts.opacity ?? 0.6);

    const inner = opts.title ? column([text(opts.title), content]) : content;
    const panel = box(inner, { border: opts.border ?? true, background: opts.background ?? '#1c1c1c' });

    const w = Math.min(opts.width ?? 60, Math.max(0, s.width - 2));
    const h = Math.min(s.measure(panel, w), Math.max(0, s.height - 2));
    const x = Math.max(0, Math.floor((s.width - w) / 2));
    const y = Math.max(0, Math.floor((s.height - h) / 2));
    s.child(panel, { x, y, width: w, height: h });
  },
});
