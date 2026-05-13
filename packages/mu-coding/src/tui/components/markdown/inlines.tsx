import { Text } from 'ink';
import type { Tokens } from 'marked';
import type { Theme } from '../../theme/types';

type InlineToken = Tokens.Strong | Tokens.Em | Tokens.Codespan | Tokens.Link | Tokens.Del | Tokens.Image | Tokens.Br | Tokens.Text | Tokens.Escape | Tokens.HTML | Tokens.Generic;

export function renderInline(token: InlineToken, theme: Theme, key: number): React.ReactNode {
  switch (token.type) {
    case 'strong':
      return (
        <Text key={key} bold color={theme.colors.bold}>
          {(token.tokens ?? []).map((t, i) => renderInline(t as InlineToken, theme, i))}
        </Text>
      );
    case 'em':
      return (
        <Text key={key} italic color={theme.colors.italic}>
          {(token.tokens ?? []).map((t, i) => renderInline(t as InlineToken, theme, i))}
        </Text>
      );
    case 'codespan':
      return (
        <Text key={key} color={theme.colors.codeFg} backgroundColor={theme.colors.codeBg}>
          {' '}
          {token.text}{' '}
        </Text>
      );
    case 'link':
      return (
        <Text key={key} color={theme.colors.link} underline>
          {(token.tokens ?? []).map((t, i) => renderInline(t as InlineToken, theme, i))}
          <Text dimColor> ({token.href})</Text>
        </Text>
      );
    case 'del':
      return (
        <Text key={key} strikethrough>
          {(token.tokens ?? []).map((t, i) => renderInline(t as InlineToken, theme, i))}
        </Text>
      );
    case 'image':
      return (
        <Text key={key} dimColor>
          [image: {token.text}]
        </Text>
      );
    case 'br':
      return <Text key={key}>{'\n'}</Text>;
    case 'escape':
      return <Text key={key}>{token.text}</Text>;
    case 'html':
      // Render inline HTML as raw text (no support for nested HTML).
      return <Text key={key} dimColor>{token.text}</Text>;
    case 'text': {
      const t = token as Tokens.Text & { tokens?: Tokens.Generic[] };
      if (t.tokens && t.tokens.length > 0) {
        return <Text key={key}>{t.tokens.map((tk, i) => renderInline(tk as InlineToken, theme, i))}</Text>;
      }
      return <Text key={key}>{t.text}</Text>;
    }
    default: {
      const raw = (token as { raw?: string; text?: string }).raw ?? (token as { text?: string }).text ?? '';
      return <Text key={key}>{raw}</Text>;
    }
  }
}

export function renderInlines(tokens: Tokens.Generic[] | undefined, theme: Theme): React.ReactNode {
  if (!tokens) return null;
  return tokens.map((t, i) => renderInline(t as InlineToken, theme, i));
}
