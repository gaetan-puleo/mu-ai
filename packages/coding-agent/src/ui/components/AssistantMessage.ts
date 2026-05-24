import type { Component, Constraints, LayoutStyle, RenderContext, Size } from 'mu-tui';
import { truncateToWidth, visibleWidth, wrapText } from 'mu-tui';
import { Box } from 'mu-tui/components';
import { getTheme, styleToAnsi } from '../theme';

export interface AssistantMessageProps {
  content: string;
}

const RESET = '\x1b[0m';
const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const LIST_RE = /^(\s*)((?:[-*+])|\d+[.)])\s+(.+)$/;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const INLINE_MARKDOWN_RE = /(`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__)/g;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const FENCE_RE = /^\s*```/;

function stripAssistantMarkdown(line: string): string {
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

function assistantMarkdownSegments(
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

function wrapAssistantMarkdownLine(
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
    return wrapAssistantMarkdownLine(
      quote[1] ?? '',
      quotePrefix,
      quotePrefix,
      quotePrefix,
      quotePrefix,
      boldPrefix,
      codePrefix,
      innerWidth,
    ).map((wrappedLine) => `${styleSegment('| ', quotePrefix)}${wrappedLine}`);
  }

  const list = LIST_RE.exec(line);
  if (list) {
    const marker = `${list[2]} `;
    const markerWidth = visibleWidth(marker);
    const innerWidth = Math.max(1, width - markerWidth);
    return wrapAssistantMarkdownLine(
      list[3] ?? '',
      textPrefix,
      headingPrefix,
      quotePrefix,
      markerPrefix,
      boldPrefix,
      codePrefix,
      innerWidth,
    ).map((wrappedLine, index) => {
      const prefix = index === 0
        ? styleSegment(marker, markerPrefix)
        : styleSegment(' '.repeat(markerWidth), markerPrefix);
      return `${prefix}${wrappedLine}`;
    });
  }

  const state: WrapState = { lines: [], current: '', col: 0 };
  const segments = assistantMarkdownSegments(line, textPrefix, headingPrefix, boldPrefix, codePrefix);
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
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function tableColumnWidths(rows: string[][], width: number): number[] {
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, column) => {
    let max = 1;
    for (const row of rows) {
      const cellWidth = visibleWidth(stripAssistantMarkdown(row[column] ?? ''));
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
  const plain = stripAssistantMarkdown(cell);
  if (visibleWidth(plain) > width) return styleSegment(truncateToWidth(plain, width), textPrefix);

  const styled = wrapAssistantMarkdownLine(
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
  return widths
    .map((columnWidth, index) => renderTableCell(cells[index] ?? '', columnWidth, cellPrefix, boldPrefix, codePrefix))
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
): { lines: string[]; nextIndex: number } {
  const rendered: string[] = [];
  let index = start + 1;
  while (index < lines.length && !FENCE_RE.test(lines[index] ?? '')) {
    const line = lines[index] ?? '';
    const padded = visibleWidth(line) > width ? truncateToWidth(line, width) : line.padEnd(width, ' ');
    rendered.push(styleSegment(padded, codeBlockPrefix));
    index += 1;
  }

  if (rendered.length === 0) rendered.push(styleSegment(' '.repeat(width), codeBlockPrefix));
  return { lines: rendered, nextIndex: index < lines.length ? index + 1 : index };
}

function renderAssistantMarkdown(
  content: string,
  width: number,
  textPrefix: string,
  headingPrefix: string,
  quotePrefix: string,
  borderPrefix: string,
  markerPrefix: string,
  boldPrefix: string,
  codePrefix: string,
  codeBlockPrefix: string,
): string[] {
  const lines = content.split('\n');
  const rendered: string[] = [];
  for (let i = 0; i < lines.length;) {
    if (FENCE_RE.test(lines[i] ?? '')) {
      const block = renderCodeBlock(lines, i, width, codeBlockPrefix);
      rendered.push(...block.lines);
      i = block.nextIndex;
      continue;
    }

    if (isTableStart(lines, i)) {
      const table = renderTableBlock(lines, i, width, textPrefix, headingPrefix, borderPrefix, boldPrefix, codePrefix);
      rendered.push(...table.lines);
      i = table.nextIndex;
      continue;
    }
    rendered.push(
      ...wrapAssistantMarkdownLine(
        lines[i] ?? '',
        textPrefix,
        headingPrefix,
        quotePrefix,
        markerPrefix,
        boldPrefix,
        codePrefix,
        width,
      ),
    );
    i += 1;
  }
  return rendered;
}

function measureAssistantMarkdown(content: string, width: number): string[] {
  const lines = content.split('\n');
  const measured: string[] = [];
  for (let i = 0; i < lines.length;) {
    if (FENCE_RE.test(lines[i] ?? '')) {
      i += 1;
      let count = 0;
      while (i < lines.length && !FENCE_RE.test(lines[i] ?? '')) {
        measured.push((lines[i] ?? '').padEnd(width, ' '));
        count += 1;
        i += 1;
      }
      if (count === 0) measured.push(' '.repeat(width));
      if (i < lines.length) i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      const rows: string[][] = [splitTableRow(lines[i] ?? '')];
      i += 2;
      while (i < lines.length && lines[i]?.includes('|') && !TABLE_SEPARATOR_RE.test(lines[i] ?? '')) {
        rows.push(splitTableRow(lines[i] ?? ''));
        i += 1;
      }
      const widths = tableColumnWidths(rows, width);
      measured.push(
        rows[0]?.map((cell, index) => stripAssistantMarkdown(cell).padEnd(widths[index] ?? 1, ' ')).join(' | ') ?? '',
        widths.map((columnWidth) => '-'.repeat(columnWidth)).join('-+-'),
        ...rows
          .slice(1)
          .map((row) =>
            row.map((cell, index) => stripAssistantMarkdown(cell).padEnd(widths[index] ?? 1, ' ')).join(' | ')
          ),
      );
      continue;
    }
    const quote = QUOTE_RE.exec(lines[i] ?? '');
    const plain = stripAssistantMarkdown(lines[i] ?? '');
    measured.push(...wrapText(quote ? `| ${plain}` : plain, width));
    i += 1;
  }
  return measured;
}

class AssistantMessageBody implements Component {
  layout: LayoutStyle;
  private content: string;

  constructor(content: string) {
    this.content = content;
    this.layout = { width: 'fill', height: 'auto' };
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const theme = getTheme(ctx);
    const prefix = styleToAnsi(theme.styles.assistantMessage);
    const headingPrefix = styleToAnsi({ ...theme.styles.assistantMessage, fg: theme.colors.warning, bold: true });
    const quotePrefix = styleToAnsi(theme.styles.muted);
    const borderPrefix = styleToAnsi(theme.styles.muted);
    const markerPrefix = styleToAnsi(theme.styles.muted);
    const boldPrefix = styleToAnsi({ ...theme.styles.assistantMessage, bold: true });
    const codePrefix = styleToAnsi({ ...theme.styles.assistantMessage, fg: theme.colors.success });
    const codeBlockPrefix = styleToAnsi({ ...theme.styles.assistantMessage, bg: theme.colors.surfaceMuted });

    const wrapped = renderAssistantMarkdown(
      this.content,
      width,
      prefix,
      headingPrefix,
      quotePrefix,
      borderPrefix,
      markerPrefix,
      boldPrefix,
      codePrefix,
      codeBlockPrefix,
    );
    const result: string[] = [];
    for (let i = 0; i < wrapped.length && result.length < height; i++) {
      const line = wrapped[i];
      const fitted = visibleWidth(line) > width ? truncateToWidth(line, width) : line;
      result.push(fitted);
    }
    return result;
  }

  measure(constraints: Constraints): Size {
    const maxWidth = Number.isFinite(constraints.maxWidth) ? Math.max(0, constraints.maxWidth) : 80;
    const wrapped = measureAssistantMarkdown(this.content, maxWidth);
    let w = 0;
    for (const line of wrapped) {
      const cw = visibleWidth(line);
      if (cw > w) w = cw;
    }
    return { width: Math.min(w, maxWidth), height: wrapped.length };
  }
}

export class AssistantMessage extends Box {
  constructor(props: AssistantMessageProps) {
    super({
      layout: {
        width: 'fill',
        height: 'auto',
        margin: { bottom: 1 },
        padding: { right: 1, left: 1 },
      },
      children: [new AssistantMessageBody(props.content)],
    });
  }
}
