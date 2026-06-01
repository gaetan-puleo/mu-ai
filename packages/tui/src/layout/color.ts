import type { Color } from './types';

export type ColorIntent = 'rgb' | 'indexed' | 'default';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
  intent: ColorIntent;
  index?: number;
}

export const DEFAULT_FG: Rgba = { r: 200, g: 200, b: 200, a: 1, intent: 'default' };

export const DEFAULT_BG: Rgba = { r: 0, g: 0, b: 0, a: 0, intent: 'default' };

export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0, intent: 'rgb' };

export const OPAQUE_BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1, intent: 'rgb' };

const NAMED_COLOR_INDEX: Record<string, number> = {
  black: 0,
  red: 1,
  green: 2,
  yellow: 3,
  blue: 4,
  magenta: 5,
  cyan: 6,
  white: 7,
  brightBlack: 8,
  brightRed: 9,
  brightGreen: 10,
  brightYellow: 11,
  brightBlue: 12,
  brightMagenta: 13,
  brightCyan: 14,
  brightWhite: 15,
};

const ANSI_16_RGB: Array<[number, number, number]> = [
  [0, 0, 0],
  [170, 0, 0],
  [0, 170, 0],
  [170, 85, 0],
  [0, 0, 170],
  [170, 0, 170],
  [0, 170, 170],
  [170, 170, 170],
  [85, 85, 85],
  [255, 85, 85],
  [85, 255, 85],
  [255, 255, 85],
  [85, 85, 255],
  [255, 85, 255],
  [85, 255, 255],
  [255, 255, 255],
];

export function colorToRgba(color: Color, alpha = 1): Rgba {
  if (color === 'default') {
    return { ...DEFAULT_FG, a: alpha };
  }
  if (typeof color === 'string' && color.startsWith('#')) {
    const parsed = parseHex(color);
    if (parsed) return { ...parsed, a: alpha * parsed.a };
  }
  const index = NAMED_COLOR_INDEX[color as keyof typeof NAMED_COLOR_INDEX];
  if (index !== undefined) {
    const [r, g, b] = ANSI_16_RGB[index];
    return { r, g, b, a: alpha, intent: 'indexed', index };
  }
  return { ...TRANSPARENT };
}

export function indexedColor(index: number, alpha = 1): Rgba {
  const [r, g, b] = palette256(index);
  return { r, g, b, a: alpha, intent: 'indexed', index };
}

export function rgbColor(r: number, g: number, b: number, alpha = 1): Rgba {
  return { r, g, b, a: alpha, intent: 'rgb' };
}

export function blendOver(front: Rgba, back: Rgba): Rgba {
  if (front.a <= 0) return back;
  if (front.a >= 1) return front;

  const fa = front.a;
  const ba = back.a;
  const outA = fa + ba * (1 - fa);
  if (outA <= 0) return { ...TRANSPARENT };

  const r = (front.r * fa + back.r * ba * (1 - fa)) / outA;
  const g = (front.g * fa + back.g * ba * (1 - fa)) / outA;
  const b = (front.b * fa + back.b * ba * (1 - fa)) / outA;

  const intent: ColorIntent = front.intent === back.intent ? front.intent : 'rgb';
  return {
    r: Math.round(r),
    g: Math.round(g),
    b: Math.round(b),
    a: outA,
    intent,
    index: intent === 'indexed' ? (front.index ?? back.index) : undefined,
  };
}

export function withOpacity(color: Rgba, opacity: number): Rgba {
  if (opacity >= 1) return color;
  if (opacity <= 0) return { ...color, a: 0 };
  return { ...color, a: color.a * opacity };
}

export function rgbaEqual(a: Rgba, b: Rgba): boolean {
  return (
    a.r === b.r &&
    a.g === b.g &&
    a.b === b.b &&
    a.a === b.a &&
    a.intent === b.intent &&
    a.index === b.index
  );
}

export function rgbaToSgr(color: Rgba, layer: 'fg' | 'bg'): string {
  if (color.intent === 'default') {
    return layer === 'fg' ? '39' : '49';
  }
  if (color.intent === 'indexed' && color.index !== undefined && color.a >= 1) {
    if (color.index < 16) {
      const base = layer === 'fg' ? 30 : 40;
      return color.index < 8 ? `${base + color.index}` : `${base + 60 + (color.index - 8)}`;
    }
    return `${layer === 'fg' ? 38 : 48};5;${color.index}`;
  }
  return `${layer === 'fg' ? 38 : 48};2;${color.r};${color.g};${color.b}`;
}

function parseHex(hex: string): Rgba | undefined {
  const body = hex.slice(1);
  if (/^[0-9a-fA-F]{3}$/.test(body)) {
    return {
      r: Number.parseInt(body[0] + body[0], 16),
      g: Number.parseInt(body[1] + body[1], 16),
      b: Number.parseInt(body[2] + body[2], 16),
      a: 1,
      intent: 'rgb',
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(body)) {
    return {
      r: Number.parseInt(body.slice(0, 2), 16),
      g: Number.parseInt(body.slice(2, 4), 16),
      b: Number.parseInt(body.slice(4, 6), 16),
      a: 1,
      intent: 'rgb',
    };
  }
  if (/^[0-9a-fA-F]{8}$/.test(body)) {
    return {
      r: Number.parseInt(body.slice(0, 2), 16),
      g: Number.parseInt(body.slice(2, 4), 16),
      b: Number.parseInt(body.slice(4, 6), 16),
      a: Number.parseInt(body.slice(6, 8), 16) / 255,
      intent: 'rgb',
    };
  }
  return undefined;
}

export function palette256(index: number): [number, number, number] {
  if (index < 0 || index > 255) return [0, 0, 0];
  if (index < 16) return ANSI_16_RGB[index];
  if (index < 232) {
    const i = index - 16;
    const r = Math.floor(i / 36);
    const g = Math.floor((i % 36) / 6);
    const b = i % 6;
    return [step6(r), step6(g), step6(b)];
  }
  const v = 8 + (index - 232) * 10;
  return [v, v, v];
}

function step6(v: number): number {
  return v === 0 ? 0 : 55 + v * 40;
}
