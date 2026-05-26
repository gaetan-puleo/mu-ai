import type { Color, Component, Constraints, LayoutStyle, RenderContext, Size } from 'mu-tui';
import { truncateToWidth, visibleWidth } from 'mu-tui';
import { getTheme, palette, styleToAnsi } from '../theme';
import { formatTokens } from '../formatTokens';
import type { ContextPartKind } from 'mu-core';
import type { Roundtrip } from 'mu-harness';

const RESET = '\x1b[0m';
const GRID_SIZE = 10;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;
const GRID_WIDTH = GRID_SIZE * 2 - 1;
const GRID_LINE_WIDTH = GRID_WIDTH + 4;
const SIDE_BY_SIDE_MIN_WIDTH = 52;

type CellKind = ContextPartKind | 'empty';

interface RenderPart {
  kind: CellKind;
  label: string;
  tokens: number;
  cells: number;
}

const PART_ORDER: ContextPartKind[] = [
  'system',
  'tools',
  'skills',
  'mcp',
  'messages',
  'tool_results',
  'other',
];

export interface ContextMapProps {
  roundtrip?: Roundtrip;
  model?: string;
}

export class ContextMap implements Component {
  layout: LayoutStyle = { width: 'fill', height: 'auto', padding: { left: 1, right: 1 }, margin: { bottom: 1 } };

  constructor(private readonly props: ContextMapProps) {}

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const lines = this.props.roundtrip ? this.renderRoundtrip(ctx, this.props.roundtrip) : this.renderEmpty(ctx);
    return lines.slice(0, height).map((line) => fitLine(line, width));
  }

  measure(constraints: Constraints): Size {
    const width = Number.isFinite(constraints.maxWidth) ? Math.min(constraints.maxWidth, 56) : 56;
    return { width, height: width >= SIDE_BY_SIDE_MIN_WIDTH ? 13 : 18 };
  }

  private renderRoundtrip(ctx: RenderContext, roundtrip: Roundtrip): string[] {
    const { width } = ctx.contentRect;
    const theme = getTheme(ctx);
    const parts = allocateParts(roundtrip);
    const used = roundtrip.usedTokens ?? sumTokens(parts.filter((part) => part.kind !== 'empty'));
    const windowLabel = roundtrip.windowTokens ? ` / ${formatTokens(roundtrip.windowTokens)}` : ' / window unknown';
    const estimatedLabel = roundtrip.estimated ? ' estimated' : '';
    const title = `Context ${formatTokens(used)}${windowLabel}${estimatedLabel}`;
    const cells = parts.flatMap((part) => Array.from({ length: part.cells }, () => part.kind)).slice(0, CELL_COUNT);
    while (cells.length < CELL_COUNT) cells.push('empty');

    const lines = [styleText(title, styleToAnsi(theme.styles.title))];
    const gridLines = renderGridLines(cells, theme);
    const legendLines = renderLegendLines(parts, theme);
    const model = roundtrip.model || this.props.model;
    if (model) legendLines.push(styleText(`model ${model}`, styleToAnsi(theme.styles.muted)));

    if (width >= SIDE_BY_SIDE_MIN_WIDTH) {
      const rowCount = Math.max(gridLines.length, legendLines.length);
      for (let i = 0; i < rowCount; i++) {
        const grid = padVisible(gridLines[i] ?? '', GRID_LINE_WIDTH);
        const legend = legendLines[i] ?? '';
        lines.push(legend ? `${grid}  ${legend}` : grid);
      }
      return lines;
    }

    lines.push(...gridLines);
    lines.push('');
    lines.push(...legendLines);
    return lines;
  }

  private renderEmpty(ctx: RenderContext): string[] {
    const theme = getTheme(ctx);
    const lines = [styleText('Context unavailable', styleToAnsi(theme.styles.title))];
    const cells = Array.from({ length: CELL_COUNT }, () => 'empty' as const);
    lines.push(...renderGridLines(cells, theme));
    lines.push(
      styleText('Send a message first; backend usage is reported after a response.', styleToAnsi(theme.styles.muted)),
    );
    return lines;
  }
}

function renderGridLines(cells: CellKind[], theme: ReturnType<typeof getTheme>): string[] {
  const lines = [borderTop(theme.colors.border)];
  for (let row = 0; row < GRID_SIZE; row++) {
    const start = row * GRID_SIZE;
    const rowCells = cells
      .slice(start, start + GRID_SIZE)
      .map((kind) => renderCell(kind, theme.colors.textMuted));
    lines.push(
      `${styleText('│', colorStyle(theme.colors.border))} ${rowCells.join(' ')} ${
        styleText('│', colorStyle(theme.colors.border))
      }`,
    );
  }
  lines.push(borderBottom(theme.colors.border));
  return lines;
}

function renderLegendLines(parts: RenderPart[], theme: ReturnType<typeof getTheme>): string[] {
  const lines: string[] = [];
  for (const part of parts.filter((item) => item.tokens > 0 || item.kind === 'empty')) {
    const square = renderCell(part.kind, theme.colors.textMuted);
    const label = part.label.padEnd(12, ' ');
    lines.push(`${square} ${label} ${formatTokens(part.tokens)}`);
  }
  return lines;
}

function allocateParts(roundtrip: Roundtrip): RenderPart[] {
  const rawParts = PART_ORDER.flatMap((kind) => {
    const matching = roundtrip.parts.filter((part) => part.kind === kind);
    const tokens = sumTokens(matching);
    return tokens > 0 ? [{ kind, label: matching[0]?.label ?? labelContextPart(kind), tokens, cells: 0 }] : [];
  });
  const estimatedUsed = sumTokens(rawParts);
  const used = roundtrip.usedTokens ?? estimatedUsed;
  const window = Math.max(used, roundtrip.windowTokens ?? used);
  const scaled = scalePartsToTotal(rawParts, used, estimatedUsed);
  const usedCells = window > 0 ? Math.min(CELL_COUNT, Math.max(0, Math.round((used / window) * CELL_COUNT))) : 0;
  const allocated = allocateCells(scaled, usedCells);
  const emptyTokens = Math.max(0, window - used);
  const emptyCells = Math.max(0, CELL_COUNT - sumCells(allocated));
  return [...allocated, { kind: 'empty', label: 'empty', tokens: emptyTokens, cells: emptyCells }];
}

function scalePartsToTotal(parts: RenderPart[], target: number, current: number): RenderPart[] {
  if (parts.length === 0 || current <= 0 || target === current) return parts;
  const scaled = parts.map((part) => ({ ...part, tokens: Math.max(0, Math.round(part.tokens * (target / current))) }));
  let diff = target - sumTokens(scaled);
  while (diff !== 0) {
    const idx = scaled.reduce((best, part, i) => (part.tokens > scaled[best].tokens ? i : best), 0);
    scaled[idx].tokens += diff > 0 ? 1 : -1;
    if (scaled[idx].tokens < 0) {
      scaled[idx].tokens = 0;
      break;
    }
    diff += diff > 0 ? -1 : 1;
  }
  return scaled;
}

function allocateCells(parts: RenderPart[], totalCells: number): RenderPart[] {
  if (parts.length === 0 || totalCells <= 0) return parts.map((part) => ({ ...part, cells: 0 }));
  const totalTokens = sumTokens(parts);
  const allocated = parts.map((part) => ({
    ...part,
    cells: part.tokens > 0 ? Math.max(1, Math.round((part.tokens / totalTokens) * totalCells)) : 0,
  }));
  while (sumCells(allocated) > totalCells) {
    const target = allocated.filter((part) => part.cells > 1).sort((a, b) => b.cells - a.cells)[0];
    if (!target) break;
    target.cells--;
  }
  while (sumCells(allocated) < totalCells) {
    const target = allocated.sort((a, b) => b.tokens - a.tokens)[0];
    if (!target) break;
    target.cells++;
  }
  return allocated;
}

function renderCell(kind: CellKind, muted: Color): string {
  const color = colorForKind(kind, muted);
  const glyph = kind === 'empty' ? '□' : '■';
  return styleText(glyph, colorStyle(color, kind === 'empty'));
}

function colorForKind(kind: CellKind, muted: Color): Color {
  switch (kind) {
    case 'system':
      return palette.blue[400];
    case 'tools':
      return palette.yellow[400];
    case 'messages':
      return palette.neutral[100];
    case 'tool_results':
      return palette.green[400];
    case 'skills':
      return palette.blue[300];
    case 'mcp':
      return palette.red[400];
    case 'other':
      return palette.neutral[400];
    case 'empty':
      return muted;
  }
}

function borderTop(color: Color): string {
  return styleText(`┌${'─'.repeat(GRID_WIDTH + 2)}┐`, colorStyle(color));
}

function borderBottom(color: Color): string {
  return styleText(`└${'─'.repeat(GRID_WIDTH + 2)}┘`, colorStyle(color));
}

function colorStyle(color: Color, dim = false): string {
  return styleToAnsi({ fg: color, dim });
}

function styleText(value: string, prefix: string): string {
  return prefix ? `${prefix}${value}${RESET}` : value;
}

function fitLine(line: string, width: number): string {
  return visibleWidth(line) > width ? truncateToWidth(line, width) : line;
}

function padVisible(line: string, width: number): string {
  const padding = width - visibleWidth(line);
  return padding > 0 ? `${line}${' '.repeat(padding)}` : line;
}

function sumTokens(parts: Array<{ tokens: number }>): number {
  return parts.reduce((sum, part) => sum + part.tokens, 0);
}

function sumCells(parts: Array<{ cells: number }>): number {
  return parts.reduce((sum, part) => sum + part.cells, 0);
}

function labelContextPart(kind: ContextPartKind): string {
  switch (kind) {
    case 'system':
      return 'system';
    case 'tools':
      return 'tools';
    case 'messages':
      return 'messages';
    case 'tool_results':
      return 'tool results';
    case 'skills':
      return 'skills';
    case 'mcp':
      return 'mcp';
    case 'other':
      return 'other';
  }
}
