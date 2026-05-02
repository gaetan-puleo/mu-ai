// Pure helpers for editing/navigating a `(value, cursor)` pair, where `value`
// is the buffer text (potentially multi-line) and `cursor` is a 0-based offset
// into that string in the half-open range `[0, value.length]`.
//
// All operations are pure: they take the current state and return the new
// state without mutating anything. Keeping the helpers free of any React /
// Ink dependency makes them trivially unit-testable and cheap to reason
// about (no hidden ordering, no refs).

export interface BufferState {
  value: string;
  cursor: number;
}

const WORD_RE = /\w/;

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function clampCursor(value: string, cursor: number): number {
  return clamp(cursor, 0, value.length);
}

// ─── Editing ──────────────────────────────────────────────────────────────────

export function insertAt(state: BufferState, text: string): BufferState {
  if (!text) return state;
  const cursor = clampCursor(state.value, state.cursor);
  return {
    value: state.value.slice(0, cursor) + text + state.value.slice(cursor),
    cursor: cursor + text.length,
  };
}

export function deleteBackward(state: BufferState): BufferState {
  const cursor = clampCursor(state.value, state.cursor);
  if (cursor === 0) return state;
  return {
    value: state.value.slice(0, cursor - 1) + state.value.slice(cursor),
    cursor: cursor - 1,
  };
}

export function deleteForward(state: BufferState): BufferState {
  const cursor = clampCursor(state.value, state.cursor);
  if (cursor >= state.value.length) return state;
  return {
    value: state.value.slice(0, cursor) + state.value.slice(cursor + 1),
    cursor,
  };
}

export function deleteWordBackward(state: BufferState): BufferState {
  const cursor = clampCursor(state.value, state.cursor);
  if (cursor === 0) return state;
  const start = wordStart(state.value, cursor);
  return {
    value: state.value.slice(0, start) + state.value.slice(cursor),
    cursor: start,
  };
}

/** Kill from cursor to end of line (Emacs-style Ctrl+K). */
export function killToLineEnd(state: BufferState): BufferState {
  const cursor = clampCursor(state.value, state.cursor);
  const eol = lineEnd(state.value, cursor);
  if (eol === cursor) {
    // At end of line — eat the newline itself, mirroring Emacs/readline.
    if (cursor < state.value.length) {
      return { value: state.value.slice(0, cursor) + state.value.slice(cursor + 1), cursor };
    }
    return state;
  }
  return { value: state.value.slice(0, cursor) + state.value.slice(eol), cursor };
}

/** Kill from start of line to cursor (Emacs-style Ctrl+U). */
export function killToLineStart(state: BufferState): BufferState {
  const cursor = clampCursor(state.value, state.cursor);
  const sol = lineStart(state.value, cursor);
  if (sol === cursor) return state;
  return { value: state.value.slice(0, sol) + state.value.slice(cursor), cursor: sol };
}

// ─── Movement ─────────────────────────────────────────────────────────────────

export function moveLeft(state: BufferState): BufferState {
  const cursor = clampCursor(state.value, state.cursor);
  return cursor === 0 ? state : { ...state, cursor: cursor - 1 };
}

export function moveRight(state: BufferState): BufferState {
  const cursor = clampCursor(state.value, state.cursor);
  return cursor >= state.value.length ? state : { ...state, cursor: cursor + 1 };
}

export function moveWordLeft(state: BufferState): BufferState {
  const cursor = clampCursor(state.value, state.cursor);
  return { ...state, cursor: wordStart(state.value, cursor) };
}

export function moveWordRight(state: BufferState): BufferState {
  const cursor = clampCursor(state.value, state.cursor);
  return { ...state, cursor: wordEnd(state.value, cursor) };
}

export function moveLineHome(state: BufferState): BufferState {
  const cursor = clampCursor(state.value, state.cursor);
  return { ...state, cursor: lineStart(state.value, cursor) };
}

export function moveLineEnd(state: BufferState): BufferState {
  const cursor = clampCursor(state.value, state.cursor);
  return { ...state, cursor: lineEnd(state.value, cursor) };
}

/**
 * Move the cursor up one display line. Returns `null` when the cursor is
 * already on the first line — callers can then route the keystroke to history
 * navigation instead of swallowing it. `desiredColumn` makes vertical motion
 * "sticky": it remembers the column the user originally departed from so that
 * traversing a short line and coming back lands in the original column.
 */
export function moveLineUp(state: BufferState, desiredColumn: number | null): BufferState | null {
  const { row, col } = cursorRowCol(state.value, state.cursor);
  if (row === 0) return null;
  const targetCol = desiredColumn ?? col;
  return { ...state, cursor: positionAt(state.value, row - 1, targetCol) };
}

export function moveLineDown(state: BufferState, desiredColumn: number | null): BufferState | null {
  const { row, col } = cursorRowCol(state.value, state.cursor);
  const lineCount = countLines(state.value);
  if (row >= lineCount - 1) return null;
  const targetCol = desiredColumn ?? col;
  return { ...state, cursor: positionAt(state.value, row + 1, targetCol) };
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

export function cursorRowCol(value: string, cursor: number): { row: number; col: number } {
  const c = clampCursor(value, cursor);
  let row = 0;
  let lastNl = -1;
  for (let i = 0; i < c; i++) {
    if (value.charCodeAt(i) === 10) {
      row++;
      lastNl = i;
    }
  }
  return { row, col: c - lastNl - 1 };
}

function countLines(value: string): number {
  let count = 1;
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) === 10) count++;
  }
  return count;
}

/** Resolve a `(row, col)` pair back to a flat offset, clamping to the line length. */
export function positionAt(value: string, row: number, col: number): number {
  let currentRow = 0;
  let lineStartIdx = 0;
  for (let i = 0; i <= value.length; i++) {
    const isEol = i === value.length || value.charCodeAt(i) === 10;
    if (currentRow === row && isEol) {
      const lineLength = i - lineStartIdx;
      return lineStartIdx + Math.min(col, lineLength);
    }
    if (isEol) {
      currentRow++;
      lineStartIdx = i + 1;
    }
  }
  return value.length;
}

function lineStart(value: string, cursor: number): number {
  for (let i = cursor - 1; i >= 0; i--) {
    if (value.charCodeAt(i) === 10) return i + 1;
  }
  return 0;
}

function lineEnd(value: string, cursor: number): number {
  for (let i = cursor; i < value.length; i++) {
    if (value.charCodeAt(i) === 10) return i;
  }
  return value.length;
}

/**
 * Standard "previous word boundary" semantics: skip whitespace/punctuation
 * backwards, then skip the contiguous word characters. Mirrors what shells
 * (bash/zsh) do for Ctrl+W and Alt+Left.
 */
function wordStart(value: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && !WORD_RE.test(value[i - 1])) i--;
  while (i > 0 && WORD_RE.test(value[i - 1])) i--;
  return i;
}

function wordEnd(value: string, cursor: number): number {
  let i = cursor;
  while (i < value.length && !WORD_RE.test(value[i])) i++;
  while (i < value.length && WORD_RE.test(value[i])) i++;
  return i;
}
