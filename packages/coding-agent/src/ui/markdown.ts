import { type Component, truncateToWidth, visibleWidth, wrapText } from 'mu-tui';
import { styleToAnsi, type Theme } from './theme';

const RESET = '\x1b[0m';
const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const LIST_RE = /^(\s*)((?:[-*+])|\d+[.)])\s+(.+)$/;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const INLINE_MARKDOWN_RE = /(`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__)/g;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const FENCE_RE = /^\s*```/;

function stripMarkdown(line: string): string {
  const heading = HEADING_RE.exec(line);
  const quote = QUOTE_RE.exec(line);
  const list = LIST_RE.exec(line);
  const text = heading ? (heading[2] ?? '') : quote ? (quote[1] ?? '') : list ? `${list[2]} ${list[3]}` : line;
  return text.replace(INLINE_CODE_RE, '$1').replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, '$1$2');
}

function styleSegment(text: string, prefix: string): string {
  if (!text) return '';
  return prefix ? `${prefix}${text}${RESET}` : text;
}

interface StyledSegment {
  text: string;
  prefix: string;
}

function markdownSegments(
  line: string,
  textPrefix: string,
  headingPrefix: string,
  boldPrefix: string,
  codePrefix: string,
): StyledSegment[] {
  const heading = HEADING_RE.exec(line);
  const text = heading ? (heading[2] ?? '') : line;
  const prefix = heading ? headingPrefix : textPrefix;
  const segments: StyledSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_MARKDOWN_RE)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ text: text.slice(last, index), prefix });
    if (match[2] !== undefined) segments.push({ text: match[2], prefix: codePrefix });
    else segments.push({ text: match[3] ?? match[4] ?? '', prefix: boldPrefix });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), prefix });
  return segments;
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

function appendStyled(state: WrapState, text: string, prefix: string): void {
  if (!text) return;
  state.current += styleSegment(text, prefix);
  state.col += visibleWidth(text);
}

function appendWrappedToken(state: WrapState, token: string, prefix: string, width: number): void {
  const tokenWidth = visibleWidth(token);
  if (tokenWidth === 0) return;

  if (/^\s+$/.test(token)) {
    if (state.col + tokenWidth <= width) appendStyled(state, token, prefix);
    else pushLine(state);
    return;
  }

  if (tokenWidth <= width) {
    if (state.col > 0 && state.col + tokenWidth > width) pushLine(state);
    appendStyled(state, token, prefix);
    return;
  }

  if (state.col > 0) pushLine(state);
  let chunk = '';
  let chunkWidth = 0;
  for (const ch of token) {
    const chWidth = visibleWidth(ch);
    if (chunkWidth + chWidth > width) {
      appendStyled(state, chunk, prefix);
      pushLine(state);
      chunk = ch;
      chunkWidth = chWidth;
    } else {
      chunk += ch;
      chunkWidth += chWidth;
    }
  }
  appendStyled(state, chunk, prefix);
}

function wrapMarkdownLine(
  line: string,
  textPrefix: string,
  headingPrefix: string,
  quotePrefix: string,
  markerPrefix: string,
  boldPrefix: string,
  codePrefix: string,
  width: number,
): string[] {
  const quote = QUOTE_RE.exec(line);
  if (quote) {
    const innerWidth = Math.max(1, width - 2);
    return wrapMarkdownLine(
      quote[1] ?? '',
      quotePrefix,
      quotePrefix,
      quotePrefix,
      quotePrefix,
      boldPrefix,
      codePrefix,
      innerWidth,
    )
      .map((wrappedLine) => `${styleSegment('| ', quotePrefix)}${wrappedLine}`);
  }

  const list = LIST_RE.exec(line);
  if (list) {
    const marker = `${list[2]} `;
    const markerWidth = visibleWidth(marker);
    const innerWidth = Math.max(1, width - markerWidth);
    return wrapMarkdownLine(
      list[3] ?? '',
      textPrefix,
      headingPrefix,
      quotePrefix,
      markerPrefix,
      boldPrefix,
      codePrefix,
      innerWidth,
    )
      .map((wrappedLine, index) => {
        const prefix = index === 0
          ? styleSegment(marker, markerPrefix)
          : styleSegment(' '.repeat(markerWidth), markerPrefix);
        return `${prefix}${wrappedLine}`;
      });
  }

  const state: WrapState = { lines: [], current: '', col: 0 };
  const segments = markdownSegments(line, textPrefix, headingPrefix, boldPrefix, codePrefix);
  for (const segment of segments) {
    for (const token of segment.text.split(/(\s+)/)) {
      appendWrappedToken(state, token, segment.prefix, width);
    }
  }
  state.lines.push(state.current);
  return state.lines;
}

function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index] ?? '';
  const separator = lines[index + 1] ?? '';
  return header.includes('|') && TABLE_SEPARATOR_RE.test(separator);
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function tableColumnWidths(rows: string[][], width: number): number[] {
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, column) => {
    let max = 1;
    for (const row of rows) {
      const cellWidth = visibleWidth(stripMarkdown(row[column] ?? ''));
      if (cellWidth > max) max = cellWidth;
    }
    return max;
  });

  const separatorWidth = Math.max(0, columnCount - 1) * 3;
  let total = widths.reduce((sum, value) => sum + value, 0) + separatorWidth;
  while (total > width && Math.max(...widths) > 3) {
    const widest = widths.indexOf(Math.max(...widths));
    widths[widest] -= 1;
    total -= 1;
  }
  return widths;
}

function renderTableCell(
  cell: string,
  width: number,
  textPrefix: string,
  boldPrefix: string,
  codePrefix: string,
): string {
  const plain = stripMarkdown(cell);
  if (visibleWidth(plain) > width) return styleSegment(truncateToWidth(plain, width), textPrefix);
  const styled = wrapMarkdownLine(
    cell,
    textPrefix,
    textPrefix,
    textPrefix,
    textPrefix,
    boldPrefix,
    codePrefix,
    Math.max(1, width),
  )[0] ?? '';
  const padding = Math.max(0, width - visibleWidth(plain));
  return `${styled}${styleSegment(' '.repeat(padding), textPrefix)}`;
}

function renderTableRow(
  cells: string[],
  widths: number[],
  cellPrefix: string,
  borderPrefix: string,
  boldPrefix: string,
  codePrefix: string,
): string {
  return widths.map((columnWidth, index) =>
    renderTableCell(cells[index] ?? '', columnWidth, cellPrefix, boldPrefix, codePrefix)
  )
    .join(styleSegment(' | ', borderPrefix));
}

function renderTableBlock(
  lines: string[],
  start: number,
  width: number,
  textPrefix: string,
  headingPrefix: string,
  borderPrefix: string,
  boldPrefix: string,
  codePrefix: string,
): { lines: string[]; nextIndex: number } {
  const header = splitTableRow(lines[start] ?? '');
  const rows: string[][] = [header];
  let index = start + 2;
  while (index < lines.length && lines[index]?.includes('|') && !TABLE_SEPARATOR_RE.test(lines[index] ?? '')) {
    rows.push(splitTableRow(lines[index] ?? ''));
    index += 1;
  }

  const widths = tableColumnWidths(rows, width);
  const rendered = [
    renderTableRow(header, widths, headingPrefix, borderPrefix, boldPrefix, codePrefix),
    styleSegment(widths.map((columnWidth) => '-'.repeat(columnWidth)).join('-+-'), borderPrefix),
    ...rows.slice(1).map((row) => renderTableRow(row, widths, textPrefix, borderPrefix, boldPrefix, codePrefix)),
  ];
  return {
    lines: rendered.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width) : line)),
    nextIndex: index,
  };
}

function renderCodeBlock(
  lines: string[],
  start: number,
  width: number,
  codeBlockPrefix: string,
  labelPrefix: string,
): { lines: string[]; nextIndex: number } {
  const rendered: string[] = [];
  const fenceLine = lines[start] ?? '';
  const lang = fenceLine.replace(/^\s*```/, '').trim();

  if (lang) {
    const label = ` ${lang}`;
    const padded = visibleWidth(label) > width
      ? truncateToWidth(label, width)
      : label + ' '.repeat(Math.max(0, width - visibleWidth(label)));
    rendered.push(styleSegment(padded, labelPrefix));
  }

  const PAD = 2;
  const innerWidth = Math.max(1, width - PAD);
  let index = start + 1;
  while (index < lines.length && !FENCE_RE.test(lines[index] ?? '')) {
    const line = lines[index] ?? '';
    const content = visibleWidth(line) > innerWidth ? truncateToWidth(line, innerWidth) : line;
    const padded = `${' '.repeat(PAD)}${content}${' '.repeat(Math.max(0, innerWidth - visibleWidth(content)))}`;
    rendered.push(styleSegment(padded, codeBlockPrefix));
    index += 1;
  }

  if (rendered.length === 0 || (lang && rendered.length === 1)) {
    rendered.push(styleSegment(' '.repeat(width), codeBlockPrefix));
  }

  return { lines: rendered, nextIndex: index < lines.length ? index + 1 : index };
}

interface Prefixes {
  text: string;
  heading: string;
  quote: string;
  border: string;
  marker: string;
  bold: string;
  code: string;
  codeBlock: string;
  codeBlockLabel: string;
}

function renderBlocks(content: string, width: number, p: Prefixes): string[] {
  const lines = content.split('\n');
  const rendered: string[] = [];
  for (let i = 0; i < lines.length;) {
    if (FENCE_RE.test(lines[i] ?? '')) {
      const block = renderCodeBlock(lines, i, width, p.codeBlock, p.codeBlockLabel);
      rendered.push(...block.lines);
      i = block.nextIndex;
      continue;
    }
    if (isTableStart(lines, i)) {
      const table = renderTableBlock(lines, i, width, p.text, p.heading, p.border, p.bold, p.code);
      rendered.push(...table.lines);
      i = table.nextIndex;
      continue;
    }
    rendered.push(...wrapMarkdownLine(lines[i] ?? '', p.text, p.heading, p.quote, p.marker, p.bold, p.code, width));
    i += 1;
  }
  return rendered;
}

export function renderMarkdown(content: string, width: number, theme: Theme): string[] {
  const p: Prefixes = {
    text: styleToAnsi(theme.styles.assistantMessage),
    heading: styleToAnsi({ ...theme.styles.assistantMessage, fg: theme.colors.warning, bold: true }),
    quote: styleToAnsi(theme.styles.muted),
    border: styleToAnsi(theme.styles.muted),
    marker: styleToAnsi(theme.styles.muted),
    bold: styleToAnsi({ ...theme.styles.assistantMessage, bold: true }),
    code: styleToAnsi({ ...theme.styles.assistantMessage, fg: theme.colors.success }),
    codeBlock: styleToAnsi({ ...theme.styles.assistantMessage, bg: theme.colors.surfaceMuted }),
    codeBlockLabel: styleToAnsi({ fg: theme.colors.textMuted, bg: theme.colors.surfaceMuted, dim: true }),
  };
  return renderBlocks(content, Math.max(1, width), p);
}

export function markdown(content: string, theme: Theme): Component {
  return {
    render: (s) => {
      if (s.width <= 0) return;
      const lines = renderMarkdown(content, s.width, theme);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        s.text(0, i, visibleWidth(line) > s.width ? truncateToWidth(line, s.width) : line);
      }
    },
  };
}

export { wrapText };
