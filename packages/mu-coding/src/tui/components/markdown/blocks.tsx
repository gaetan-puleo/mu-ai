import { Box, Text } from 'ink';
import type { Tokens } from 'marked';
import type { Theme } from '../../theme/types';
import { renderInlines } from './inlines';

type BlockToken =
  | Tokens.Paragraph
  | Tokens.Heading
  | Tokens.Code
  | Tokens.Blockquote
  | Tokens.List
  | Tokens.Table
  | Tokens.Hr
  | Tokens.Space
  | Tokens.HTML
  | Tokens.Generic;

function headingPrefix(depth: number): string {
  return '#'.repeat(Math.max(1, Math.min(depth, 6)));
}

function renderList(token: Tokens.List, theme: Theme, key: number, depth = 0): React.ReactNode {
  return (
    <Box key={key} flexDirection="column" marginLeft={depth * 2}>
      {token.items.map((item, idx) => {
        const startNum = typeof token.start === 'number' ? token.start : 1;
        const marker = token.ordered ? `${startNum + idx}.` : '•';
        return (
          <Box key={idx} flexDirection="row">
            <Text color={theme.colors.muted}>{marker} </Text>
            <Box flexDirection="column">
              {item.tokens.map((t, i) => {
                if (t.type === 'list') {
                  return renderList(t as Tokens.List, theme, i, depth + 1);
                }
                return renderBlock(t as BlockToken, theme, i);
              })}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

function renderTable(token: Tokens.Table, theme: Theme, key: number): React.ReactNode {
  const widths: number[] = token.header.map((h) => h.text.length);
  for (const row of token.rows) {
    row.forEach((cell, i) => {
      const len = cell.text.length;
      if (len > (widths[i] ?? 0)) widths[i] = len;
    });
  }
  const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - s.length));
  const sep = widths.map((w) => '─'.repeat(w + 2)).join('┼');
  return (
    <Box key={key} flexDirection="column" marginY={0}>
      <Text color={theme.colors.tableBorder}>{`┌${widths.map((w) => '─'.repeat(w + 2)).join('┬')}┐`}</Text>
      <Text>
        <Text color={theme.colors.tableBorder}>│ </Text>
        {token.header.map((h, i) => (
          <Text key={i} bold>
            {pad(h.text, widths[i] ?? 0)}
            <Text color={theme.colors.tableBorder}> │ </Text>
          </Text>
        ))}
      </Text>
      <Text color={theme.colors.tableBorder}>{`├${sep}┤`}</Text>
      {token.rows.map((row, rowIdx) => (
        <Text key={rowIdx}>
          <Text color={theme.colors.tableBorder}>│ </Text>
          {row.map((cell, i) => (
            <Text key={i}>
              {pad(cell.text, widths[i] ?? 0)}
              <Text color={theme.colors.tableBorder}> │ </Text>
            </Text>
          ))}
        </Text>
      ))}
      <Text color={theme.colors.tableBorder}>{`└${widths.map((w) => '─'.repeat(w + 2)).join('┴')}┘`}</Text>
    </Box>
  );
}

export function renderBlock(token: BlockToken, theme: Theme, key: number): React.ReactNode {
  switch (token.type) {
    case 'paragraph': {
      const t = token as Tokens.Paragraph;
      return (
        <Box key={key} flexDirection="row" flexWrap="wrap">
          <Text>{renderInlines(t.tokens, theme)}</Text>
        </Box>
      );
    }
    case 'heading': {
      const t = token as Tokens.Heading;
      return (
        <Box key={key} marginTop={key === 0 ? 0 : 1}>
          <Text bold color={theme.colors.heading}>
            {headingPrefix(t.depth)} {renderInlines(t.tokens, theme)}
          </Text>
        </Box>
      );
    }
    case 'code': {
      const t = token as Tokens.Code;
      const lang = t.lang ? ` ${t.lang}` : '';
      return (
        <Box key={key} flexDirection="column" borderStyle="single" borderColor={theme.colors.border} paddingX={1}>
          {lang ? <Text dimColor>{lang.trim()}</Text> : null}
          <Text color={theme.colors.codeFg}>{t.text}</Text>
        </Box>
      );
    }
    case 'blockquote': {
      const t = token as Tokens.Blockquote;
      return (
        <Box key={key} flexDirection="row">
          <Text color={theme.colors.blockquote}>│ </Text>
          <Box flexDirection="column">
            {(t.tokens ?? []).map((c, i) => renderBlock(c as BlockToken, theme, i))}
          </Box>
        </Box>
      );
    }
    case 'list':
      return renderList(token as Tokens.List, theme, key);
    case 'table':
      return renderTable(token as Tokens.Table, theme, key);
    case 'hr':
      return (
        <Text key={key} color={theme.colors.muted}>
          {'─'.repeat(40)}
        </Text>
      );
    case 'space':
      return <Text key={key}> </Text>;
    case 'html':
      return (
        <Text key={key} dimColor>
          {(token as Tokens.HTML).text}
        </Text>
      );
    default: {
      const raw = (token as { raw?: string; text?: string }).raw ?? (token as { text?: string }).text ?? '';
      if (!raw) return null;
      return <Text key={key}>{raw}</Text>;
    }
  }
}
