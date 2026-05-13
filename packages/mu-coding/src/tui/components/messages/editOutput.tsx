import { Box, Text } from 'ink';
import { useTheme } from '../../theme/ThemeContext';
import { diffLines } from '../../utils/diff';

export interface EditOutputProps {
  args: { path?: string; from?: string; to?: string };
  content: string;
  error: boolean;
}

export function EditOutput({ args, content, error }: EditOutputProps) {
  const theme = useTheme();
  if (error) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor={theme.colors.error} paddingX={1}>
        <Text color={theme.colors.error}>edit failed{args.path ? ` (${args.path})` : ''}</Text>
        <Text>{content}</Text>
      </Box>
    );
  }

  const diff = args.from !== undefined && args.to !== undefined ? diffLines(args.from, args.to) : [];

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.colors.border} paddingX={1}>
      <Text dimColor>edit {args.path ?? ''}</Text>
      {diff.length === 0 ? (
        <Text>{content}</Text>
      ) : (
        diff.map((line, i) => (
          <Text
            key={i}
            color={line.type === 'add' ? theme.colors.diffAdd : line.type === 'remove' ? theme.colors.diffRemove : undefined}
          >
            {line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  '}
            {line.text}
          </Text>
        ))
      )}
    </Box>
  );
}
