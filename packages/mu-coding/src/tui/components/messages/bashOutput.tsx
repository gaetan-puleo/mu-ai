import { Box, Text } from 'ink';
import { useTheme } from '../../theme/ThemeContext';

export function BashOutput({ content, error }: { content: string; error: boolean }) {
  const theme = useTheme();
  const lines = content.split('\n');
  const head = lines.slice(0, 30);
  const omitted = Math.max(0, lines.length - head.length);
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={error ? theme.colors.error : theme.colors.border} paddingX={1}>
      <Text dimColor>bash{error ? ' (error)' : ''}</Text>
      {head.map((l, i) => (
        <Text key={i} color={error ? theme.colors.error : undefined}>
          {l}
        </Text>
      ))}
      {omitted > 0 ? <Text dimColor>… +{omitted} more line{omitted === 1 ? '' : 's'}</Text> : null}
    </Box>
  );
}
