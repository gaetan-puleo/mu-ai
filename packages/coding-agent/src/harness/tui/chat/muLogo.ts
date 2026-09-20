import { type Color, type Component } from 'mu-tui';
import { styleToAnsi, type Theme } from './theme';

const RESET = '\x1b[0m';

// Braille dot bit layout within a 2-col x 4-row cell.
const BIT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;

/** Rasterise a '#'/'.' dot bitmap into Braille characters (2x4 dots per cell). */
const toBraille = (rows: readonly string[]): string[] => {
  const h = rows.length;
  const w = rows[0].length;
  const out: string[] = [];
  for (let cy = 0; cy < h; cy += 4) {
    let line = '';
    for (let cx = 0; cx < w; cx += 2) {
      let bits = 0;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
          if (rows[cy + r][cx + c] === '#') bits |= BIT[r][c];
        }
      }
      line += String.fromCodePoint(0x2800 + bits);
    }
    out.push(line);
  }
  return out;
};

// Greek mu (μ), filled — thick strokes rasterised into Braille for a smooth
// round-dot look (same technique as the GitLab tanuki mark).
const MU_BITMAP = [
  '.####....####.',
  '.####....####.',
  '.####....####.',
  '.####....####.',
  '.####....####.',
  '.####....####.',
  '.####....####.',
  '.####....####.',
  '.####....####.',
  '.####....####.',
  '.####...#####.',
  '.####.######..',
  '.#########....',
  '.####.........',
  '.####.........',
  '.####.........',
] as const;

/** The mu mark as Braille lines (7 cells wide x 4 rows tall). */
export const MU_LOGO: readonly string[] = toBraille(MU_BITMAP);

const parseHex = (c: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

/** Linear interpolation between two hex colors (t=0 → a, t=1 → b). */
export const mixHex = (a: string, b: string, t: number): Color => {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return (t < 0.5 ? a : b) as Color;
  const ch = (i: number): string =>
    Math.round(pa[i] + (pb[i] - pa[i]) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(0)}${ch(1)}${ch(2)}` as Color;
};

/**
 * Blue→green gradient color for a given vertical position (0=top, 1=bottom).
 * Biased toward blue so the mark reads as "bleu-vert" with more blue up top.
 */
export const muGradientColor = (top: string, bottom: string, t: number): Color =>
  mixHex(top, bottom, Math.pow(t, 1.4));

/** Render the green mu mark at the top-left of the given surface. */
export const muLogo = (theme: Theme): Component => ({
  render: (s) => {
    const green = styleToAnsi({ fg: theme.colors.success });
    MU_LOGO.forEach((line, i) => {
      if (i < s.height) s.text(0, i, `${green}${line}${RESET}`);
    });
  },
});
