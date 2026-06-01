// deno-lint-ignore no-control-regex
const ANSI_RE = /\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g;
// deno-lint-ignore no-control-regex
const ANSI_TOKEN_RE = /\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007]*(?:\u0007|\u001B\\)/gy;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

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

export function charWidth(code: number): number {
  if (code === 0 || code < 0x20 || code === 0x7f) return 0;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x231a && code <= 0x231b) ||
    (code >= 0x2329 && code <= 0x232a) ||
    (code >= 0x23e9 && code <= 0x23f3) ||
    (code >= 0x23f8 && code <= 0x23fa) ||
    (code >= 0x25fd && code <= 0x25fe) ||
    (code >= 0x2614 && code <= 0x2615) ||
    (code >= 0x2648 && code <= 0x2653) ||
    code === 0x267f ||
    code === 0x2693 ||
    code === 0x26a1 ||
    (code >= 0x26aa && code <= 0x26ab) ||
    (code >= 0x26bd && code <= 0x26be) ||
    (code >= 0x26c4 && code <= 0x26c5) ||
    code === 0x26ce ||
    code === 0x26d4 ||
    code === 0x26ea ||
    (code >= 0x26f2 && code <= 0x26f3) ||
    code === 0x26f5 ||
    code === 0x26fa ||
    code === 0x26fd ||
    code === 0x2702 ||
    code === 0x2705 ||
    (code >= 0x2708 && code <= 0x270d) ||
    code === 0x270f ||
    code === 0x2712 ||
    code === 0x2714 ||
    code === 0x2716 ||
    code === 0x271d ||
    code === 0x2721 ||
    code === 0x2728 ||
    (code >= 0x2733 && code <= 0x2734) ||
    code === 0x2744 ||
    code === 0x2747 ||
    code === 0x274c ||
    code === 0x274e ||
    (code >= 0x2753 && code <= 0x2755) ||
    code === 0x2757 ||
    (code >= 0x2795 && code <= 0x2797) ||
    code === 0x27a1 ||
    code === 0x27b0 ||
    code === 0x27bf ||
    (code >= 0x2934 && code <= 0x2935) ||
    (code >= 0x2b05 && code <= 0x2b07) ||
    (code >= 0x2b1b && code <= 0x2b1c) ||
    code === 0x2b50 ||
    code === 0x2b55 ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f004 && code <= 0x1f004) ||
    (code >= 0x1f0cf && code <= 0x1f0cf) ||
    (code >= 0x1f170 && code <= 0x1f171) ||
    code === 0x1f17e ||
    code === 0x1f17f ||
    code === 0x1f18e ||
    (code >= 0x1f191 && code <= 0x1f19a) ||
    (code >= 0x1f1e0 && code <= 0x1f1ff) ||
    (code >= 0x1f200 && code <= 0x1f202) ||
    code === 0x1f21a ||
    code === 0x1f22f ||
    (code >= 0x1f232 && code <= 0x1f23a) ||
    (code >= 0x1f250 && code <= 0x1f251) ||
    (code >= 0x1f300 && code <= 0x1f321) ||
    (code >= 0x1f324 && code <= 0x1f393) ||
    (code >= 0x1f396 && code <= 0x1f397) ||
    (code >= 0x1f399 && code <= 0x1f39b) ||
    (code >= 0x1f39e && code <= 0x1f3f0) ||
    (code >= 0x1f3f3 && code <= 0x1f3f5) ||
    (code >= 0x1f3f7 && code <= 0x1f4fd) ||
    (code >= 0x1f4ff && code <= 0x1f53d) ||
    (code >= 0x1f549 && code <= 0x1f54e) ||
    (code >= 0x1f550 && code <= 0x1f567) ||
    (code >= 0x1f56f && code <= 0x1f570) ||
    (code >= 0x1f573 && code <= 0x1f57a) ||
    code === 0x1f587 ||
    (code >= 0x1f58a && code <= 0x1f58d) ||
    code === 0x1f590 ||
    (code >= 0x1f595 && code <= 0x1f596) ||
    code === 0x1f5a4 ||
    (code >= 0x1f5a5 && code <= 0x1f5a8) ||
    (code >= 0x1f5b1 && code <= 0x1f5b2) ||
    code === 0x1f5bc ||
    (code >= 0x1f5c2 && code <= 0x1f5c4) ||
    (code >= 0x1f5d1 && code <= 0x1f5d3) ||
    (code >= 0x1f5dc && code <= 0x1f5de) ||
    code === 0x1f5e1 ||
    code === 0x1f5e3 ||
    code === 0x1f5e8 ||
    code === 0x1f5ef ||
    code === 0x1f5f3 ||
    (code >= 0x1f5fa && code <= 0x1f64f) ||
    (code >= 0x1f680 && code <= 0x1f6c5) ||
    (code >= 0x1f6cb && code <= 0x1f6d2) ||
    (code >= 0x1f6d5 && code <= 0x1f6d7) ||
    (code >= 0x1f6e0 && code <= 0x1f6e5) ||
    code === 0x1f6e9 ||
    (code >= 0x1f6eb && code <= 0x1f6ec) ||
    code === 0x1f6f0 ||
    (code >= 0x1f6f3 && code <= 0x1f6fc) ||
    (code >= 0x1f7e0 && code <= 0x1f7eb) ||
    (code >= 0x1f90c && code <= 0x1f93a) ||
    (code >= 0x1f93c && code <= 0x1f945) ||
    (code >= 0x1f947 && code <= 0x1f9ff) ||
    (code >= 0x1fa00 && code <= 0x1fa53) ||
    (code >= 0x1fa60 && code <= 0x1fa6d) ||
    (code >= 0x1fa70 && code <= 0x1fa7c) ||
    (code >= 0x1fa80 && code <= 0x1fa88) ||
    (code >= 0x1fa90 && code <= 0x1fabd) ||
    (code >= 0x1fabf && code <= 0x1fac5) ||
    (code >= 0x1face && code <= 0x1fadb) ||
    (code >= 0x1fae0 && code <= 0x1fae8) ||
    (code >= 0x1faf0 && code <= 0x1faf8)
  ) {
    return 2;
  }
  return 1;
}

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
