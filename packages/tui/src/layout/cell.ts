import { DEFAULT_BG, DEFAULT_FG, type Rgba, rgbaEqual } from './color';

export interface CellStyle {
  fg: Rgba;
  bg: Rgba;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  reverse: boolean;
  blink: boolean;
  link?: string;
}

export interface Cell {
  grapheme: string;
  width: 0 | 1 | 2;
  style: CellStyle;
}

export const DEFAULT_STYLE: CellStyle = {
  fg: DEFAULT_FG,
  bg: DEFAULT_BG,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strikethrough: false,
  reverse: false,
  blink: false,
};

export function defaultStyle(): CellStyle {
  return {
    fg: DEFAULT_FG,
    bg: DEFAULT_BG,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    strikethrough: false,
    reverse: false,
    blink: false,
  };
}

export function emptyCell(): Cell {
  return { grapheme: ' ', width: 1, style: defaultStyle() };
}

export function continuationCell(): Cell {
  return { grapheme: '', width: 0, style: defaultStyle() };
}

export function styleEqual(a: CellStyle, b: CellStyle): boolean {
  return (
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.reverse === b.reverse &&
    a.blink === b.blink &&
    a.link === b.link &&
    rgbaEqual(a.fg, b.fg) &&
    rgbaEqual(a.bg, b.bg)
  );
}

export function cellEqual(a: Cell, b: Cell): boolean {
  return a.grapheme === b.grapheme && a.width === b.width && styleEqual(a.style, b.style);
}
