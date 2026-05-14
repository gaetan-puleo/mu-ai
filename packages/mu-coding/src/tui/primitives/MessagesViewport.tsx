import { Box, type DOMElement, measureElement, Text, useInput, useWindowSize } from 'ink';
import React from 'react';
import { enableMouseWheel } from './mouseWheel';

const { useEffect, useLayoutEffect, useMemo, useRef, useState } = React;

/** How many visual lines the mouse wheel scrolls per notch. */
const WHEEL_STEP_LINES = 3;

export interface ViewportRow {
  /** Stable key for React reconciliation. */
  id: string;
  /** Renderable element for this row when it's fully visible. */
  node: React.ReactNode;
  /**
   * Plain-text representation of the row's wrapped content (no padding, no
   * margin). Must match what `node` visibly produces inside its content area
   * so scrolling math is coherent. Used both for line counting and for
   * partial rendering when the row is clipped at the top or bottom of the
   * viewport.
   */
  text: string;
  /**
   * Styled blank rows above the wrapped content. These are rendered as part
   * of the row by Ink (e.g. via `paddingTop` on a Box). The viewport adds
   * them to the line count so partial scrolling preserves the row's height
   * exactly. Defaults to 0.
   */
  paddingTop?: number;
  /**
   * Styled blank rows below the wrapped content (e.g. `paddingBottom` on a
   * Box). Defaults to 0.
   */
  paddingBottom?: number;
  /**
   * Background color applied to padding rows AND to wrapped content lines
   * when they are rendered as a partial slice. Preserves the row's visual
   * identity (e.g. user message highlight) even when scrolled across an
   * edge. Omit for "no background".
   */
  backgroundColor?: string;
  /** Trailing blank line(s) below the row (no background). Defaults to 1. */
  marginBottom?: number;
  /**
   * Foreground styling applied to wrapped-content lines (NOT padding/margin
   * lines) when the row is rendered as a partial slice. When the row is
   * fully visible, `node` is rendered verbatim and these hints are unused.
   * Used to keep e.g. dim reasoning text dim when it straddles a viewport
   * edge — otherwise the partial slice would render as bright normal text.
   */
  style?: {
    dimColor?: boolean;
    color?: string;
  };
}

export interface MessagesViewportProps {
  rows: readonly ViewportRow[];
  /** Minimum height (in rows) to allocate to the viewport. Defaults to 3. */
  minHeight?: number;
  /** When true (default), arrow/page/Home/End keys scroll the viewport. */
  scrollable?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Width helpers — minimal, no extra deps.
// ─────────────────────────────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI CSI/OSC stripping.
const ANSI_RE = /\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g;

/** Strip ANSI escape sequences before counting width. */
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

/**
 * Cheap visual width for a single code point. CJK ranges count as 2; C0
 * controls as 0; everything else as 1. Good enough for line-count estimation.
 */
function charWidth(code: number): number {
  if (code === 0) return 0;
  if (code < 0x20) return 0;
  if (code === 0x7f) return 0;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  ) {
    return 2;
  }
  return 1;
}

function visualWidth(s: string): number {
  const stripped = stripAnsi(s);
  let w = 0;
  for (let i = 0; i < stripped.length; ) {
    const code = stripped.codePointAt(i) ?? 0;
    w += charWidth(code);
    i += code > 0xffff ? 2 : 1;
  }
  return w;
}

// ─────────────────────────────────────────────────────────────────────────────
// Word-wrap simulation. Produces a list of visual lines (strings) at a given
// terminal width. The behavior mirrors what Ink's `<Text>` renders.
// ─────────────────────────────────────────────────────────────────────────────

interface WrapState {
  /** Completed lines so far. */
  lines: string[];
  /** Current line being built. */
  current: string;
  /** Visual width of `current`. */
  col: number;
}

function pushLine(state: WrapState): void {
  state.lines.push(state.current);
  state.current = '';
  state.col = 0;
}

function pushWhitespace(state: WrapState, tok: string, w: number, width: number): void {
  if (state.col === 0) return;
  if (state.col + w <= width) {
    state.current += tok;
    state.col += w;
    return;
  }
  pushLine(state); // whitespace at end of line gets dropped
}

function pushLongWord(state: WrapState, tok: string, width: number): void {
  if (state.col > 0) pushLine(state);
  // Hard-break the token. Since visual width may not equal char count for
  // CJK, we walk code points and split when the running width reaches
  // `width`. Approximation: every code point contributes 1 or 2 cols.
  let i = 0;
  let buf = '';
  let bufW = 0;
  while (i < tok.length) {
    const code = tok.codePointAt(i) ?? 0;
    const chW = charWidth(code);
    const chStr = code > 0xffff ? tok.slice(i, i + 2) : tok.slice(i, i + 1);
    if (bufW + chW > width) {
      state.lines.push(buf);
      buf = chStr;
      bufW = chW;
    } else {
      buf += chStr;
      bufW += chW;
    }
    i += code > 0xffff ? 2 : 1;
  }
  state.current = buf;
  state.col = bufW;
}

function pushWord(state: WrapState, tok: string, w: number, width: number): void {
  if (w > width) {
    pushLongWord(state, tok, width);
    return;
  }
  if (state.col + w > width) {
    pushLine(state);
    state.current = tok;
    state.col = w;
    return;
  }
  state.current += tok;
  state.col += w;
}

function wrapSegment(segment: string, width: number): string[] {
  if (segment.length === 0) return [''];
  const tokens = segment.split(/(\s+)/);
  const state: WrapState = { lines: [], current: '', col: 0 };
  for (const tok of tokens) {
    if (tok.length === 0) continue;
    const w = visualWidth(tok);
    if (w === 0) continue;
    if (/^\s+$/.test(tok)) {
      pushWhitespace(state, tok, w, width);
    } else {
      pushWord(state, tok, w, width);
    }
  }
  state.lines.push(state.current);
  return state.lines;
}

/**
 * Split text into the array of visual lines it occupies once word-wrapped at
 * `width`. Handles `\n`, CJK widths, and ANSI escapes (in width counting).
 * Exported for tests.
 */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0 || !text) return [''];
  const out: string[] = [];
  for (const segment of text.split('\n')) {
    const wrapped = wrapSegment(segment, width);
    for (const ln of wrapped) out.push(ln);
  }
  return out.length === 0 ? [''] : out;
}

/**
 * Count how many terminal lines a string occupies once word-wrapped at
 * `width`. Equivalent to `wrapText(text, width).length` plus a guarantee
 * of at least 1. Exported for tests.
 */
export function countWrappedLines(text: string, width: number): number {
  return Math.max(1, wrapText(text, width).length);
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure helper: compute the visual scrollbar geometry (thumb position and
 * size) in *bar character* units.
 */
export interface ScrollbarGeometry {
  thumbTop: number;
  thumbHeight: number;
}

export function computeScrollbar(
  totalLines: number,
  viewLines: number,
  scrolledLines: number,
  barHeight: number,
): ScrollbarGeometry {
  if (barHeight <= 0 || totalLines <= 0) return { thumbTop: 0, thumbHeight: 0 };
  const thumbHeight = Math.max(1, Math.min(barHeight, Math.round((barHeight * viewLines) / totalLines)));
  const trackSpace = barHeight - thumbHeight;
  const hidden = Math.max(0, totalLines - viewLines);
  const ratio = hidden === 0 ? 0 : Math.min(1, Math.max(0, scrolledLines / hidden));
  const thumbTop = Math.round(trackSpace * ratio);
  return { thumbTop, thumbHeight };
}

/** Build a prefix-sum array such that `cumLines[i]` = total lines of rows 0..i-1. */
export function buildLineOffsets(rowLines: readonly number[]): number[] {
  const cum = new Array<number>(rowLines.length + 1);
  cum[0] = 0;
  for (let i = 0; i < rowLines.length; i++) cum[i + 1] = (cum[i] ?? 0) + (rowLines[i] ?? 0);
  return cum;
}

/**
 * Given line offsets and a visual-line cursor, return `{rowIndex, lineWithinRow}`.
 * Returns `{0, 0}` for an empty list.
 */
export function findRowAtLine(cumLines: readonly number[], line: number): { rowIndex: number; lineWithinRow: number } {
  if (cumLines.length <= 1) return { rowIndex: 0, lineWithinRow: 0 };
  // Binary search for the row whose [cum[i], cum[i+1]) contains `line`.
  let lo = 0;
  let hi = cumLines.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if ((cumLines[mid] ?? 0) <= line) lo = mid;
    else hi = mid - 1;
  }
  const start = cumLines[lo] ?? 0;
  return { rowIndex: lo, lineWithinRow: Math.max(0, line - start) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A scrollable transcript container.
 *
 * The viewport scrolls by **visual lines**, not by whole messages. A long
 * assistant reply can be scrolled into; you don't jump over it.
 *
 * Layout: fills its parent flex container; height is measured post-render
 * with `measureElement`. Siblings (prompt, status bar, palette, modals) take
 * their natural height and the viewport gets the rest.
 *
 * Scroll behavior:
 *  - Sticks to the bottom while new content streams in.
 *  - User scroll up disengages stick-to-bottom. End / scrolling back to the
 *    very last line re-engages it.
 *
 * Keys (only when `scrollable`):
 *  - ↑ / ↓        — 1 visual line
 *  - PgUp / PgDn  — one viewport (≈ visible-height lines)
 *  - Home / End   — top / bottom
 *  - mouse wheel  — 3 lines per notch
 */
export function MessagesViewport({
  rows,
  minHeight = 3,
  scrollable = true,
}: MessagesViewportProps): React.ReactElement {
  const { columns, rows: termRows } = useWindowSize();
  const containerRef = useRef<DOMElement | null>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number>(Math.max(minHeight, termRows - 6));

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const { height } = measureElement(node);
    if (height > 0 && height !== measuredHeight) {
      setMeasuredHeight(height);
    }
  });

  const available = Math.max(minHeight, measuredHeight);

  // Per-row pre-wrapped lines. Cached by (id, text length, padding/margin,
  // backgroundColor, columns) so a streaming tail row is the only thing
  // recomputed per token.
  interface RowCache {
    textLen: number;
    pt: number;
    pb: number;
    mb: number;
    bg: string | undefined;
    dim: boolean;
    color: string | undefined;
    cols: number;
    wrapped: string[];
    /** pt + wrapped.length + pb + mb */
    lines: number;
  }
  const cacheRef = useRef<Map<string, RowCache>>(new Map());
  const wrappedRows = useMemo(() => {
    const cache = cacheRef.current;
    const out: RowCache[] = new Array<RowCache>(rows.length);
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] as ViewportRow;
      seen.add(r.id);
      const textLen = r.text.length;
      const pt = r.paddingTop ?? 0;
      const pb = r.paddingBottom ?? 0;
      const mb = r.marginBottom ?? 1;
      const bg = r.backgroundColor;
      const dim = r.style?.dimColor ?? false;
      const color = r.style?.color;
      const cached = cache.get(r.id);
      if (
        cached &&
        cached.textLen === textLen &&
        cached.pt === pt &&
        cached.pb === pb &&
        cached.mb === mb &&
        cached.bg === bg &&
        cached.dim === dim &&
        cached.color === color &&
        cached.cols === columns
      ) {
        out[i] = cached;
        continue;
      }
      const wrapped = wrapText(r.text, columns);
      const entry: RowCache = {
        textLen,
        pt,
        pb,
        mb,
        bg,
        dim,
        color,
        cols: columns,
        wrapped,
        lines: pt + wrapped.length + pb + mb,
      };
      cache.set(r.id, entry);
      out[i] = entry;
    }
    if (cache.size > seen.size) {
      for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k);
    }
    return out;
  }, [rows, columns]);

  const rowLines = useMemo(() => wrappedRows.map((r) => r.lines), [wrappedRows]);
  const cumLines = useMemo(() => buildLineOffsets(rowLines), [rowLines]);
  const totalLines = cumLines[cumLines.length - 1] ?? 0;
  const maxFirstLine = Math.max(0, totalLines - available);

  const [stickToBottom, setStickToBottom] = useState(true);
  const [firstLine, setFirstLine] = useState(0);

  // When sticking to bottom, follow new content automatically.
  useEffect(() => {
    if (stickToBottom) setFirstLine(maxFirstLine);
  }, [stickToBottom, maxFirstLine]);

  // Clamp when transcript shrinks or grows past the cursor.
  useEffect(() => {
    setFirstLine((f) => {
      if (f > maxFirstLine) return maxFirstLine;
      if (f < 0) return 0;
      return f;
    });
  }, [maxFirstLine]);

  // Scroll helpers — line-based.
  const scrollUp = (n: number): void => {
    if (maxFirstLine === 0) return;
    setStickToBottom(false);
    setFirstLine((f) => Math.max(0, f - n));
  };
  const scrollDown = (n: number): void => {
    if (maxFirstLine === 0) return;
    setFirstLine((f) => {
      const target = Math.min(maxFirstLine, f + n);
      if (target >= maxFirstLine) {
        setStickToBottom(true);
        return maxFirstLine;
      }
      return target;
    });
  };
  const scrollToTop = (): void => {
    if (maxFirstLine === 0) return;
    setStickToBottom(false);
    setFirstLine(0);
  };
  const scrollToBottom = (): void => {
    setStickToBottom(true);
    setFirstLine(maxFirstLine);
  };

  useInput(
    (_input, key) => {
      if (!scrollable) return;
      if (key.upArrow) scrollUp(1);
      else if (key.downArrow) scrollDown(1);
      else if (key.pageUp) scrollUp(Math.max(1, available));
      else if (key.pageDown) scrollDown(Math.max(1, available));
      else if (key.home) scrollToTop();
      else if (key.end) scrollToBottom();
    },
    { isActive: scrollable },
  );

  useEffect(() => {
    if (!scrollable) return;
    const disable = enableMouseWheel({
      onWheelUp: () => scrollUp(WHEEL_STEP_LINES),
      onWheelDown: () => scrollDown(WHEEL_STEP_LINES),
    });
    return disable;
  }, [scrollable, maxFirstLine]);

  // ── Slice rows for rendering ───────────────────────────────────────────
  //
  // We render visible content as a sequence of `<Text>` lines, in a single
  // column Box. For rows that are FULLY visible we still render their
  // original `node` (preserves styling). For the top/bottom partial rows we
  // render plain text slices.

  const lastLineExclusive = Math.min(totalLines, firstLine + available);

  const { rowIndex: firstRow, lineWithinRow: firstLineInRow } = findRowAtLine(cumLines, firstLine);
  // The last visible line is `lastLineExclusive - 1`. Find its row.
  const lastLineCursor = Math.max(firstLine, lastLineExclusive - 1);
  const { rowIndex: lastRow, lineWithinRow: lastLineInRow } = findRowAtLine(cumLines, lastLineCursor);

  interface RenderItem {
    key: string;
    node: React.ReactNode;
  }
  const renderItems: RenderItem[] = [];

  for (let i = firstRow; i <= lastRow && i < wrappedRows.length; i++) {
    const cache = wrappedRows[i] as RowCache;
    const row = rows[i] as ViewportRow;
    const isTop = i === firstRow;
    const isBottom = i === lastRow;
    const startInRow = isTop ? firstLineInRow : 0;
    const totalRowLines = cache.lines;
    const endInRow = isBottom ? lastLineInRow + 1 : totalRowLines;

    const fullyVisible = startInRow === 0 && endInRow === totalRowLines;
    if (fullyVisible) {
      renderItems.push({ key: row.id, node: <React.Fragment key={row.id}>{row.node}</React.Fragment> });
      continue;
    }

    // Partial: render line-by-line, mapping each line index to one of the
    // four zones (paddingTop / wrapped / paddingBottom / marginBottom) and
    // rendering with the right styling so the row's visual identity (e.g. a
    // user message's colored background) is preserved at the clipping edge.
    const wrapped = cache.wrapped;
    const wrappedEnd = cache.pt + wrapped.length;
    const padBottomEnd = wrappedEnd + cache.pb;
    for (let li = startInRow; li < endInRow; li++) {
      let text = '';
      let useBg = false;
      let isContent = false;
      if (li < cache.pt) {
        // Top padding row — styled with backgroundColor if present.
        useBg = true;
      } else if (li < wrappedEnd) {
        text = wrapped[li - cache.pt] ?? '';
        useBg = true;
        isContent = true;
      } else if (li < padBottomEnd) {
        useBg = true;
      } else {
        // Margin line — always plain.
        useBg = false;
      }
      const bg = useBg ? cache.bg : undefined;
      const dim = isContent ? cache.dim : false;
      const color = isContent ? cache.color : undefined;
      renderItems.push({
        key: `${row.id}::${li}`,
        node: (
          <Text key={`${row.id}::${li}`} backgroundColor={bg} dimColor={dim} color={color}>
            {text || ' '}
          </Text>
        ),
      });
    }
  }

  // Scrollbar geometry — in line space.
  const viewLines = Math.min(totalLines, available);
  const showScrollbar = totalLines > available && available >= 2;
  const { thumbTop, thumbHeight } = showScrollbar
    ? computeScrollbar(totalLines, viewLines, firstLine, available)
    : { thumbTop: 0, thumbHeight: 0 };

  return (
    <Box ref={containerRef} flexDirection="row" flexGrow={1} flexShrink={1} overflow="hidden">
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {renderItems.map((it) => (
          <React.Fragment key={it.key}>{it.node}</React.Fragment>
        ))}
      </Box>
      {showScrollbar ? (
        <Box flexDirection="column" flexShrink={0} width={1} marginLeft={1}>
          {Array.from({ length: available }, (_, i) => {
            const inThumb = i >= thumbTop && i < thumbTop + thumbHeight;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: bar cells have no per-position state; index is the natural key.
              <Text key={`bar-${i}`} dimColor={!inThumb} color={inThumb ? 'cyan' : undefined}>
                {inThumb ? '█' : '│'}
              </Text>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}
