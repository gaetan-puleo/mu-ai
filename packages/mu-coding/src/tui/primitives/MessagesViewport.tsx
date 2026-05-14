import { Box, Text, useInput, useWindowSize } from 'ink';
import React from 'react';

const { useEffect, useMemo, useRef, useState } = React;

export interface ViewportRow {
  /** Stable key for React reconciliation. */
  id: string;
  /** Renderable element for this row. */
  node: React.ReactNode;
  /**
   * Plain-text approximation of the row's content used to estimate how many
   * terminal lines it will occupy after wrapping at the current width. Should
   * include any badges/prefixes so the count matches what `node` actually
   * renders.
   */
  text: string;
  /** Extra blank lines this row adds (e.g. trailing margin). Defaults to 1. */
  marginBottom?: number;
}

export interface MessagesViewportProps {
  rows: readonly ViewportRow[];
  /** Number of terminal rows consumed by surrounding UI (prompt + status bar, etc.). */
  reservedRows: number;
  /** Minimum height (in rows) to allocate to the viewport. Defaults to 3. */
  minHeight?: number;
  /** When true (default), arrow/page keys scroll the viewport. */
  scrollable?: boolean;
}

/**
 * Count how many terminal lines a string occupies once wrapped at `width`.
 * Handles explicit newlines and approximates word-wrap by character count
 * (good enough for chat content — no ANSI/grapheme awareness).
 */
function countWrappedLines(text: string, width: number): number {
  if (width <= 0) return 1;
  if (!text) return 1;
  let lines = 0;
  const segments = text.split('\n');
  for (const seg of segments) {
    if (seg.length === 0) {
      lines += 1;
    } else {
      lines += Math.ceil(seg.length / width);
    }
  }
  return Math.max(1, lines);
}

/**
 * A scrollable transcript container.
 *
 * - Auto-sticks to the latest row when new content arrives, so streaming
 *   updates feel natural.
 * - When the user scrolls up (↑ / PgUp), auto-stick disengages so they can
 *   read history. End / PgDn / scrolling back to the bottom re-engages it.
 * - When older rows are above the visible window, a dim header indicates
 *   how many are hidden; when newer rows are below, a dim footer does the
 *   same.
 */
export function MessagesViewport({
  rows,
  reservedRows,
  minHeight = 3,
  scrollable = true,
}: MessagesViewportProps): React.ReactElement {
  const { rows: termRows, columns } = useWindowSize();
  const available = Math.max(minHeight, termRows - reservedRows);

  // Per-row estimated line counts at the current terminal width.
  const rowLines = useMemo(() => {
    return rows.map((r) => countWrappedLines(r.text, columns) + (r.marginBottom ?? 0));
  }, [rows, columns]);

  // `firstVisible` is the index of the topmost rendered row. When
  // `stickToBottom` is true (default), we always recompute it so the latest
  // row stays in view. When the user scrolls up, we freeze it.
  const [stickToBottom, setStickToBottom] = useState(true);
  const [firstVisible, setFirstVisible] = useState(0);

  // Compute the index of the topmost row that fits when anchored to the bottom.
  const bottomAnchoredFirst = useMemo(() => {
    if (rows.length === 0) return 0;
    let used = 0;
    let first = rows.length - 1;
    for (let i = rows.length - 1; i >= 0; i--) {
      const lines = rowLines[i] ?? 1;
      if (i === rows.length - 1) {
        // Always include the last row even if it overflows alone.
        used = lines;
        first = i;
        continue;
      }
      if (used + lines > available) break;
      used += lines;
      first = i;
    }
    return first;
  }, [rows.length, rowLines, available]);

  // When sticking to bottom, follow new content automatically.
  const lastRowsLengthRef = useRef(rows.length);
  useEffect(() => {
    if (stickToBottom) {
      setFirstVisible(bottomAnchoredFirst);
    }
    lastRowsLengthRef.current = rows.length;
  }, [stickToBottom, bottomAnchoredFirst, rows.length]);

  // Clamp `firstVisible` to a valid range whenever inputs change.
  useEffect(() => {
    setFirstVisible((f) => Math.min(Math.max(0, f), Math.max(0, rows.length - 1)));
  }, [rows.length]);

  // Compute the index of the last row that fits starting at `firstVisible`.
  const computeLastVisible = (start: number): number => {
    let used = 0;
    let last = start;
    for (let i = start; i < rows.length; i++) {
      const lines = rowLines[i] ?? 1;
      if (i === start) {
        used = lines;
        last = i;
        continue;
      }
      if (used + lines > available) break;
      used += lines;
      last = i;
    }
    return last;
  };

  // Scroll helpers.
  const scrollUpRows = (n: number): void => {
    setStickToBottom(false);
    setFirstVisible((f) => Math.max(0, f - n));
  };
  const scrollDownRows = (n: number): void => {
    setFirstVisible((f) => {
      const target = Math.min(bottomAnchoredFirst, f + n);
      // If we've reached the bottom-anchored position, re-engage sticky mode.
      if (target >= bottomAnchoredFirst) {
        setStickToBottom(true);
        return bottomAnchoredFirst;
      }
      return target;
    });
  };
  const scrollToTop = (): void => {
    setStickToBottom(false);
    setFirstVisible(0);
  };
  const scrollToBottom = (): void => {
    setStickToBottom(true);
    setFirstVisible(bottomAnchoredFirst);
  };

  useInput(
    (input, key) => {
      if (!scrollable) return;
      if (key.upArrow) scrollUpRows(1);
      else if (key.downArrow) scrollDownRows(1);
      else if (key.pageUp) scrollUpRows(Math.max(1, Math.floor(available / 2)));
      else if (key.pageDown) scrollDownRows(Math.max(1, Math.floor(available / 2)));
      else if (input === 'g') scrollToTop();
      else if (input === 'G') scrollToBottom();
    },
    { isActive: scrollable },
  );

  const lastVisible = computeLastVisible(firstVisible);
  const hiddenAbove = firstVisible;
  const hiddenBelow = Math.max(0, rows.length - 1 - lastVisible);

  // Reserve lines for headers/footers when they're shown.
  const headerHeight = hiddenAbove > 0 ? 1 : 0;
  const footerHeight = hiddenBelow > 0 ? 1 : 0;
  const bodyHeight = Math.max(1, available - headerHeight - footerHeight);

  const visible = rows.slice(firstVisible, lastVisible + 1);

  return (
    <Box flexDirection="column" height={available} overflow="hidden">
      {hiddenAbove > 0 ? (
        <Box flexShrink={0}>
          <Text dimColor>
            ↑ {hiddenAbove} earlier {hiddenAbove === 1 ? 'message' : 'messages'}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" flexGrow={1} height={bodyHeight} overflow="hidden">
        {visible.map((row) => (
          <React.Fragment key={row.id}>{row.node}</React.Fragment>
        ))}
      </Box>
      {hiddenBelow > 0 ? (
        <Box flexShrink={0}>
          <Text dimColor>
            ↓ {hiddenBelow} newer {hiddenBelow === 1 ? 'message' : 'messages'} (press End / G)
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
