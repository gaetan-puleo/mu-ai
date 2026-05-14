import { Text } from 'ink';
import React from 'react';

const { useEffect, useState } = React;

const DOT = '·';
const SQUARE = '■';

/** Default 5-step blue/magenta gradient used for the highlighted cell. */
const DEFAULT_GRADIENT = ['#5fd7ff', '#5fafff', '#875fff', '#af5fff', '#d75fd7'];

export interface SpinnerProps {
  /** Number of cells in the row. Defaults to 8. */
  cells?: number;
  /** Hex colors cycled through for the active cell. Length determines gradient. */
  gradient?: readonly string[];
  /** Color (or hex) used for non-active cells (the dotted track). */
  trackColor?: string;
  /** How many trailing squares follow the head, each dimmer than the last. Defaults to 3. */
  trailLength?: number;
  /** Milliseconds between frames. Defaults to 100ms. */
  intervalMs?: number;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const v = Number.parseInt(m[1]!, 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

function rgbToHex({ r, g, b }: RGB): string {
  const to2 = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/** Linearly fade a hex color toward black by `amount` (0 = full color, 1 = black). */
function fadeHex(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const k = Math.max(0, Math.min(1, 1 - amount));
  return rgbToHex({
    r: Math.round(rgb.r * k),
    g: Math.round(rgb.g * k),
    b: Math.round(rgb.b * k),
  });
}

/**
 * opencode-style loader: a row of dots where one cell turns into a filled
 * square that ping-pongs left↔right. The head leaves a fading trail of
 * dimmer squares behind it as it moves, and the head's color walks through
 * a gradient.
 */
export function Spinner({
  cells = 8,
  gradient = DEFAULT_GRADIENT,
  trackColor = 'gray',
  trailLength = 3,
  intervalMs = 100,
}: SpinnerProps): React.ReactElement {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // Bounce through 2*(cells-1) steps so the square ping-pongs left↔right.
    const period = Math.max(1, (cells - 1) * 2);
    const id = setInterval(() => {
      setTick((t) => (t + 1) % period);
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [cells, intervalMs]);

  // Bouncing head index: 0,1,…,cells-1,cells-2,…,1,(then wraps to 0).
  const head = tick < cells ? tick : (cells - 1) * 2 - tick;
  // Direction of travel: +1 going right, -1 going left.
  const direction: 1 | -1 = tick < cells - 1 ? 1 : tick === cells - 1 ? 1 : -1;

  const headColor = gradient[head % gradient.length] ?? gradient[0] ?? 'white';

  const cellNodes: React.ReactElement[] = [];
  for (let i = 0; i < cells; i++) {
    if (i === head) {
      cellNodes.push(
        <Text key={i} color={headColor}>
          {SQUARE}
        </Text>,
      );
      continue;
    }
    // Distance behind the head in the direction the head is travelling
    // (positive = trailing the head). Cells ahead get no trail.
    const behind = direction === 1 ? head - i : i - head;
    if (behind > 0 && behind <= trailLength) {
      const fade = behind / (trailLength + 1); // never fully black
      const color = fadeHex(headColor, fade);
      cellNodes.push(
        <Text key={i} color={color}>
          {SQUARE}
        </Text>,
      );
    } else {
      cellNodes.push(
        <Text key={i} color={trackColor} dimColor>
          {DOT}
        </Text>,
      );
    }
  }

  // Interleave with single-space separators so the row reads "· · ■ · ·".
  const out: React.ReactNode[] = [];
  cellNodes.forEach((node, i) => {
    if (i > 0) out.push(<Text key={`s${i}`}> </Text>);
    out.push(node);
  });
  return <>{out}</>;
}
