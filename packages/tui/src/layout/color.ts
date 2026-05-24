import type { Color } from './types';

/**
 * Color intent — preserves how a color should be emitted to the terminal.
 *
 * - `rgb`: literal 24-bit color, emitted as `CSI 38;2;R;G;B m`.
 * - `indexed`: ANSI palette slot, emitted as `CSI 38;5;N m`. Keeps an RGB
 *   snapshot so blending math can work against an approximate value.
 * - `default`: terminal default color, emitted as `CSI 39 m` / `CSI 49 m`.
 *
 * When two colors of different intents are blended together, the result is
 * downgraded to `rgb` because the original intent metadata cannot be preserved
 * across compositing math.
 */
export type ColorIntent = 'rgb' | 'indexed' | 'default';

/** RGBA color with intent metadata. r/g/b are 0-255, a is 0.0-1.0. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
  intent: ColorIntent;
  /** Palette index when intent is `'indexed'`. */
  index?: number;
}

/** Default foreground — terminal's configured fg, fully opaque. */
export const DEFAULT_FG: Rgba = { r: 200, g: 200, b: 200, a: 1, intent: 'default' };

/** Default background — fully transparent so cells behind show through. */
export const DEFAULT_BG: Rgba = { r: 0, g: 0, b: 0, a: 0, intent: 'default' };

/** Fully transparent rgb (used as a generic "blend-through" sentinel). */
export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0, intent: 'rgb' };

/** Opaque black, used as the fallback backdrop when none is provided. */
export const OPAQUE_BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1, intent: 'rgb' };

/** ANSI 16-color palette RGB approximations (xterm-style). */
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
  [0, 0, 0], // black
  [170, 0, 0], // red
  [0, 170, 0], // green
  [170, 85, 0], // yellow
  [0, 0, 170], // blue
  [170, 0, 170], // magenta
  [0, 170, 170], // cyan
  [170, 170, 170], // white
  [85, 85, 85], // brightBlack
  [255, 85, 85], // brightRed
  [85, 255, 85], // brightGreen
  [255, 255, 85], // brightYellow
  [85, 85, 255], // brightBlue
  [255, 85, 255], // brightMagenta
  [85, 255, 255], // brightCyan
  [255, 255, 255], // brightWhite
];

/** Convert a layout `Color` to an `Rgba` with appropriate intent. */
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

/** Build an Rgba from an ANSI 256-color palette index (0-255). */
export function indexedColor(index: number, alpha = 1): Rgba {
  const [r, g, b] = palette256(index);
  return { r, g, b, a: alpha, intent: 'indexed', index };
}

/** Build a literal RGB color. */
export function rgbColor(r: number, g: number, b: number, alpha = 1): Rgba {
  return { r, g, b, a: alpha, intent: 'rgb' };
}

/**
 * Porter-Duff source-over compositing.
 * Fast paths: front.a === 0 returns back, front.a === 1 returns front.
 * Intent downgrades to `rgb` when the two inputs disagree.
 */
export function blendOver(front: Rgba, back: Rgba): Rgba {
  if (front.a <= 0) return back;
  if (front.a >= 1) return front;

  const fa = front.a;
  const ba = back.a;
  const outA = fa + ba * (1 - fa);
  if (outA <= 0) return { ...TRANSPARENT };

  // Premultiplied blend, then unpremultiply.
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

/** Multiply the alpha channel of `color` by `opacity`. */
export function withOpacity(color: Rgba, opacity: number): Rgba {
  if (opacity >= 1) return color;
  if (opacity <= 0) return { ...color, a: 0 };
  return { ...color, a: color.a * opacity };
}

/** Fast equality for diffing/coalescing. */
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

/** Emit minimal SGR parameters for a color on the given layer. */
export function rgbaToSgr(color: Rgba, layer: 'fg' | 'bg'): string {
  // For semi-transparent colors that reach the emit stage, the caller is
  // expected to have already composited against the backdrop. Emit opaque RGB.
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

/** Resolve an ANSI 256-color palette index to its RGB approximation. */
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
