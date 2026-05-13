import { Box, Text } from 'ink';
import type React from 'react';
import { useTheme } from '../theme/ThemeContext';
import type { Theme } from '../theme/types';

/**
 * Zero-dependency Markdown renderer for assistant messages. Restored from
 * `5c5ae8c:.../messages/markdown.tsx` and re-targeted at the current flat
 * `theme.colors.*` palette.
 *
 * Implementation is two-pass:
 *  - `parseBlocks` splits the raw text into a list of typed blocks
 *  - each block has its own React renderer that delegates inline
 *    formatting to `renderInline` for paragraph / list / heading content.
 *
 * No external markdown dependency: works in any host shipping `mu-coding`
 * without forcing them to ship a parser. Replaces the previous
 * `marked`-based 3-file renderer.
 */

// ─── Block model ──────────────────────────────────────────────────────────────

type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; lang: string; lines: string[] }
  | { type: 'quote'; lines: string[] }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'hr' };

const FENCE = /^```(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const UL_ITEM = /^(\s*)[-*+]\s+(.*)$/;
const OL_ITEM = /^(\s*)\d+\.\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const HR = /^\s*(---|\*\*\*|___)\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;

function splitTableRow(line: string): string[] {
  // Trim outer pipes then split. Handles `| a | b |` and `a | b`.
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: block parsing is dispatch-heavy
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: single parser dispatch loop — every block kind consumed inline keeps the cursor (`i`) local; splitting would scatter it.
function parseBlocks(input: string): Block[] {
  const lines = input.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Code fence — capture until matching closing fence (or EOF).
    const fence = line.match(FENCE);
    if (fence) {
      const lang = (fence[1] ?? '').trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) {
        codeLines.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      blocks.push({ type: 'code', lang, lines: codeLines });
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1]!.length as 1 | 2 | 3, text: heading[2] ?? '' });
      i++;
      continue;
    }

    // Quote — consume consecutive `> ` lines.
    if (QUOTE.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) {
        const m = (lines[i] ?? '').match(QUOTE);
        quoteLines.push(m ? (m[1] ?? '') : '');
        i++;
      }
      blocks.push({ type: 'quote', lines: quoteLines });
      continue;
    }

    // Table — header row, separator row, then body rows.
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1] ?? '')) {
      const header = splitTableRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i] ?? '')) {
        rows.push(splitTableRow(lines[i] ?? ''));
        i++;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    // List — ordered or unordered, contiguous items only.
    const ulMatch = line.match(UL_ITEM);
    const olMatch = line.match(OL_ITEM);
    if (ulMatch || olMatch) {
      const ordered = !!olMatch;
      const re = ordered ? OL_ITEM : UL_ITEM;
      const items: string[] = [];
      while (i < lines.length) {
        const m = (lines[i] ?? '').match(re);
        if (!m) break;
        items.push(m[2] ?? '');
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Paragraph — contiguous non-empty, non-block lines.
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      if (cur.trim() === '') break;
      if (FENCE.test(cur) || HEADING.test(cur) || QUOTE.test(cur) || HR.test(cur)) break;
      if (UL_ITEM.test(cur) || OL_ITEM.test(cur)) break;
      if (TABLE_ROW.test(cur) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1] ?? '')) break;
      paraLines.push(cur);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
    }
  }

  return blocks;
}

// ─── Inline rendering ─────────────────────────────────────────────────────────

interface InlineToken {
  kind: 'text' | 'bold' | 'italic' | 'code' | 'link';
  text: string;
  href?: string;
}

const INLINE_PATTERNS: { kind: InlineToken['kind']; re: RegExp; capture: number; href?: number }[] = [
  // Order matters: longer / more specific patterns first.
  { kind: 'code', re: /`([^`\n]+)`/, capture: 1 },
  { kind: 'link', re: /\[([^\]]+)\]\(([^)]+)\)/, capture: 1, href: 2 },
  { kind: 'bold', re: /\*\*([^*\n]+)\*\*/, capture: 1 },
  { kind: 'bold', re: /__([^_\n]+)__/, capture: 1 },
  { kind: 'italic', re: /\*([^*\n]+)\*/, capture: 1 },
  { kind: 'italic', re: /_([^_\n]+)_/, capture: 1 },
];

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: greedy inline tokenizer — earliest-match across patterns then advance; the branching is the algorithm.
function tokenizeInline(input: string): InlineToken[] {
  const out: InlineToken[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    let bestIdx = -1;
    let bestMatch: { kind: InlineToken['kind']; text: string; href?: string; raw: string } | null = null;
    for (const p of INLINE_PATTERNS) {
      const sub = input.slice(cursor);
      const m = sub.match(p.re);
      if (m && m.index !== undefined) {
        if (bestIdx === -1 || m.index < bestIdx) {
          bestIdx = m.index;
          bestMatch = {
            kind: p.kind,
            text: m[p.capture] ?? '',
            href: p.href !== undefined ? m[p.href] : undefined,
            raw: m[0],
          };
        }
      }
    }
    if (!bestMatch || bestIdx === -1) {
      out.push({ kind: 'text', text: input.slice(cursor) });
      break;
    }
    if (bestIdx > 0) {
      out.push({ kind: 'text', text: input.slice(cursor, cursor + bestIdx) });
    }
    out.push({ kind: bestMatch.kind, text: bestMatch.text, href: bestMatch.href });
    cursor += bestIdx + bestMatch.raw.length;
  }
  return out;
}

function renderInline(text: string, theme: Theme, baseColor?: string): React.ReactNode[] {
  const tokens = tokenizeInline(text);
  return tokens.map((tok, i) => {
    const key = `${i}-${tok.kind}`;
    if (tok.kind === 'text') {
      return (
        <Text key={key} color={baseColor}>
          {tok.text}
        </Text>
      );
    }
    if (tok.kind === 'bold') {
      return (
        <Text key={key} color={baseColor ?? theme.colors.bold} bold>
          {tok.text}
        </Text>
      );
    }
    if (tok.kind === 'italic') {
      return (
        <Text key={key} color={baseColor ?? theme.colors.italic} italic>
          {tok.text}
        </Text>
      );
    }
    if (tok.kind === 'code') {
      return (
        <Text key={key} color={theme.colors.codeFg} backgroundColor={theme.colors.codeBg}>
          {` ${tok.text} `}
        </Text>
      );
    }
    if (tok.kind === 'link') {
      return (
        <Text key={key} color={theme.colors.link} underline>
          {tok.text}
          {tok.href ? (
            <Text color={theme.colors.link} dimColor>
              {' '}
              ({tok.href})
            </Text>
          ) : null}
        </Text>
      );
    }
    return null;
  });
}

// ─── Block renderers ──────────────────────────────────────────────────────────

function HeadingBlock({ block, theme }: { block: Extract<Block, { type: 'heading' }>; theme: Theme }) {
  const prefix = block.level === 1 ? '# ' : block.level === 2 ? '## ' : '### ';
  return (
    <Box marginBottom={1}>
      <Text color={theme.colors.heading} bold={block.level <= 2}>
        {prefix}
        {block.text}
      </Text>
    </Box>
  );
}

function ParagraphBlock({
  block,
  theme,
  color,
}: {
  block: Extract<Block, { type: 'paragraph' }>;
  theme: Theme;
  color?: string;
}) {
  return (
    <Box marginBottom={1}>
      <Text wrap="wrap" color={color}>
        {renderInline(block.text, theme, color)}
      </Text>
    </Box>
  );
}

function ListBlock({
  block,
  theme,
  color,
}: {
  block: Extract<Block, { type: 'list' }>;
  theme: Theme;
  color?: string;
}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {block.items.map((item, idx) => {
        const marker = block.ordered ? `${idx + 1}.` : '•';
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: list items have no stable id
          <Box key={idx}>
            <Text color={theme.colors.muted}>{`  ${marker} `}</Text>
            <Box flexShrink={1} flexGrow={1}>
              <Text wrap="wrap" color={color}>
                {renderInline(item, theme, color)}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

function CodeBlock({ block, theme }: { block: Extract<Block, { type: 'code' }>; theme: Theme }) {
  return (
    <Box flexDirection="column" marginBottom={1} paddingX={1} backgroundColor={theme.colors.codeBg}>
      {block.lang ? (
        <Text dimColor color={theme.colors.codeFg}>
          {block.lang}
        </Text>
      ) : null}
      {block.lines.map((ln, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: code lines have no stable id and may repeat
        <Text key={`${i}-${ln}`} color={theme.colors.codeFg}>
          {ln || ' '}
        </Text>
      ))}
    </Box>
  );
}

function QuoteBlock({ block, theme }: { block: Extract<Block, { type: 'quote' }>; theme: Theme }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {block.lines.map((ln, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blockquote lines render in document order and never reorder — index is the only stable identifier.
        <Box key={`${i}-${ln}`}>
          <Text color={theme.colors.blockquote}> │ </Text>
          <Box flexShrink={1} flexGrow={1}>
            <Text wrap="wrap" color={theme.colors.blockquote} italic>
              {renderInline(ln, theme, theme.colors.blockquote)}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function TableBlock({ block, theme }: { block: Extract<Block, { type: 'table' }>; theme: Theme }) {
  // Compute column widths based on the longest cell per column.
  const colCount = Math.max(block.header.length, ...block.rows.map((r) => r.length));
  const widths: number[] = new Array(colCount).fill(0);
  for (let c = 0; c < colCount; c++) {
    widths[c] = (block.header[c] ?? '').length;
    for (const row of block.rows) {
      widths[c] = Math.max(widths[c]!, (row[c] ?? '').length);
    }
  }
  const renderRow = (cells: string[], bold: boolean, key: string) => (
    <Box key={key}>
      {Array.from({ length: colCount }, (_, c) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: table columns have fixed positions for the lifetime of the row; reordering is impossible.
        <Box key={c} marginRight={c === colCount - 1 ? 0 : 2}>
          <Text bold={bold}>{(cells[c] ?? '').padEnd(widths[c]!)}</Text>
        </Box>
      ))}
    </Box>
  );
  const sep = (
    <Box>
      {Array.from({ length: colCount }, (_, c) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: separator cells map 1:1 to columns — column index is the natural key.
        <Box key={c} marginRight={c === colCount - 1 ? 0 : 2}>
          <Text color={theme.colors.tableBorder}>{'─'.repeat(widths[c]!)}</Text>
        </Box>
      ))}
    </Box>
  );
  return (
    <Box flexDirection="column" marginBottom={1}>
      {renderRow(block.header, true, 'header')}
      {sep}
      {block.rows.map((r, i) => renderRow(r, false, `r-${i}`))}
    </Box>
  );
}

function HrBlock({ theme }: { theme: Theme }) {
  return (
    <Box marginBottom={1}>
      <Text color={theme.colors.tableBorder}>{'─'.repeat(40)}</Text>
    </Box>
  );
}

// ─── Public renderer ─────────────────────────────────────────────────────────

/**
 * Public entrypoint. The previous revision used a 3-file `marked`-based
 * pipeline (`render.tsx` / `blocks.tsx` / `inlines.tsx`) which depended on
 * the `marked` npm package; this file replaces all three with a single
 * hand-rolled parser. The export name `Markdown` matches what the previous
 * pipeline exported so consumer imports don't need to change.
 */
export function Markdown({ text, color }: { text: string; color?: string }) {
  const theme = useTheme();
  if (!text) return null;
  const blocks = parseBlocks(text);
  return (
    <Box flexDirection="column">
      {blocks.map((b, i) => {
        const key = `${i}-${b.type}`;
        if (b.type === 'heading') return <HeadingBlock key={key} block={b} theme={theme} />;
        if (b.type === 'paragraph') return <ParagraphBlock key={key} block={b} theme={theme} color={color} />;
        if (b.type === 'list') return <ListBlock key={key} block={b} theme={theme} color={color} />;
        if (b.type === 'code') return <CodeBlock key={key} block={b} theme={theme} />;
        if (b.type === 'quote') return <QuoteBlock key={key} block={b} theme={theme} />;
        if (b.type === 'table') return <TableBlock key={key} block={b} theme={theme} />;
        if (b.type === 'hr') return <HrBlock key={key} theme={theme} />;
        return null;
      })}
    </Box>
  );
}
