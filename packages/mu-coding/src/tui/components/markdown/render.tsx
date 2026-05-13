import { Box } from 'ink';
import { marked, type Tokens } from 'marked';
import { useTheme } from '../../theme/ThemeContext';
import { renderBlock } from './blocks';

export function Markdown({ text }: { text: string }) {
  const theme = useTheme();
  if (!text) return null;
  const tokens = marked.lexer(text) as Tokens.Generic[];
  return (
    <Box flexDirection="column">{tokens.map((t, i) => renderBlock(t, theme, i))}</Box>
  );
}
