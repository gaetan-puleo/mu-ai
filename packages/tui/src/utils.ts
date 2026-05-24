// deno-lint-ignore no-control-regex
const ANSI_RE = /\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g;
// deno-lint-ignore no-control-regex
const ANSI_TOKEN_RE = /\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007]*(?:\u0007|\u001B\\)/gy;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

/**
 * Calculate the visible width of a string, ignoring ANSI escape codes.
 * CJK characters count as 2, everything else as 1.
 */
export function visibleWidth(s: string): number {
  const stripped = stripAnsi(s);
  let w = 0;
  for (let i = 0; i < stripped.length;) {
    const code = stripped.codePointAt(i) ?? 0;
    w += charWidth(code);
    i += code > 0xffff ? 2 : 1;
  }
  return w;
}

function charWidth(code: number): number {
  if (code === 0 || code < 0x20 || code === 0x7f) return 0;
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

/**
 * Truncate a string to `width` visible columns, preserving ANSI codes.
 * Appends `ellipsis` (default: `"…"`) if truncated.
 */
export function truncateToWidth(s: string, width: number, ellipsis = '\u2026'): string {
  if (visibleWidth(s) <= width) return s;
  const ellipsisWidth = visibleWidth(ellipsis);
  let result = '';
  let currentWidth = 0;
  const targetWidth = Math.max(0, width - ellipsisWidth);

  for (const token of tokenizeAnsi(s)) {
    if (token.ansi) {
      result += token.value;
      continue;
    }

    for (const ch of token.value) {
      const code = ch.codePointAt(0) ?? 0;
      const chWidth = charWidth(code);
      if (currentWidth + chWidth > targetWidth) {
        return result + ellipsis + extractTrailingAnsi(s);
      }
      result += ch;
      currentWidth += chWidth;
    }
  }

  return result + ellipsis + extractTrailingAnsi(s);
}

export function wrapText(text: string, width: number): string[] {
  if (width <= 0 || !text) return [''];
  const out: string[] = [];
  for (const segment of text.split('\n')) {
    const wrapped = wrapSegment(segment, width);
    out.push(...wrapped);
  }
  return out.length === 0 ? [''] : out;
}

interface WrapState {
  lines: string[];
  current: string;
  col: number;
}

function pushLine(state: WrapState): void {
  state.lines.push(state.current);
  state.current = '';
  state.col = 0;
}

function wrapSegment(segment: string, width: number): string[] {
  if (segment.length === 0) return [''];
  const tokens = segment.split(/(\s+)/);
  const state: WrapState = { lines: [], current: '', col: 0 };

  for (const tok of tokens) {
    if (tok.length === 0) continue;
    const w = visibleWidth(tok);
    if (w === 0) continue;

    if (/^\s+$/.test(tok)) {
      if (state.col === 0) {
        state.current += tok;
        state.col += w;
      } else if (state.col + w <= width) {
        state.current += tok;
        state.col += w;
      } else {
        pushLine(state);
      }
    } else if (w > width) {
      if (state.col > 0) pushLine(state);
      let j = 0;
      let buf = '';
      let bufW = 0;
      while (j < tok.length) {
        const code = tok.codePointAt(j) ?? 0;
        const chW = charWidth(code);
        const chStr = code > 0xffff ? tok.slice(j, j + 2) : tok.slice(j, j + 1);
        if (bufW + chW > width) {
          state.lines.push(buf);
          buf = chStr;
          bufW = chW;
        } else {
          buf += chStr;
          bufW += chW;
        }
        j += code > 0xffff ? 2 : 1;
      }
      state.current = buf;
      state.col = bufW;
    } else if (state.col + w > width) {
      pushLine(state);
      state.current = tok;
      state.col = w;
    } else {
      state.current += tok;
      state.col += w;
    }
  }

  state.lines.push(state.current);
  return state.lines;
}

/**
 * Slice a string by visible column range, preserving ANSI codes.
 * `strict: true` prevents splitting a wide character at the boundary.
 */
export function sliceByColumn(s: string, start: number, end: number, strict = false): string {
  let col = 0;
  let result = '';

  for (const token of tokenizeAnsi(s)) {
    if (token.ansi) {
      result += token.value;
      continue;
    }

    for (const ch of token.value) {
      const code = ch.codePointAt(0) ?? 0;
      const chWidth = charWidth(code);
      const nextCol = col + chWidth;

      if (nextCol > start) {
        if (col >= end) return result + extractTrailingAnsi(s);
        if (col >= start) {
          if (!strict || nextCol <= end) result += ch;
        }
      }

      col = nextCol;
    }
  }

  return result + extractTrailingAnsi(s);
}

function tokenizeAnsi(s: string): Array<{ value: string; ansi: boolean }> {
  const tokens: Array<{ value: string; ansi: boolean }> = [];
  let index = 0;

  while (index < s.length) {
    ANSI_TOKEN_RE.lastIndex = index;
    const match = ANSI_TOKEN_RE.exec(s);
    if (match) {
      tokens.push({ value: match[0], ansi: true });
      index = ANSI_TOKEN_RE.lastIndex;
      continue;
    }

    const nextEsc = s.indexOf('\x1b', index + 1);
    const end = nextEsc === -1 ? s.length : nextEsc;
    tokens.push({ value: s.slice(index, end), ansi: false });
    index = end;
  }

  return tokens;
}

function extractTrailingAnsi(s: string): string {
  // deno-lint-ignore no-control-regex
  const match = s.match(/(\u001B\[[0-?]*[ -/]*[@-~])$/);
  return match ? match[1] : '';
}
