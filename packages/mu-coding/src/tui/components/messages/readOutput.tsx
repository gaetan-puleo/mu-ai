import { Box, Text } from 'ink';
import { useTheme } from '../../theme/ThemeContext';

export function ReadOutput({ args, content, error }: { args: { path?: string }; content: string; error: boolean }) {
  const theme = useTheme();
  if (error) {
    return (
      <Box flexDirection="row" borderStyle="single" borderColor={theme.colors.error} paddingX={1}>
        <Text color={theme.colors.error}>read failed: {content}</Text>
      </Box>
    );
  }
  const lines = content.split('\n');
  const head = lines.slice(0, 30);
  const omitted = Math.max(0, lines.length - head.length);
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.colors.border} paddingX={1}>
      <Text dimColor>read {args.path ?? ''}</Text>
      {head.map((l, i) => (
        <Text key={i}>{l}</Text>
      ))}
      {omitted > 0 ? <Text dimColor>… +{omitted} more</Text> : null}
    </Box>
  );
}
