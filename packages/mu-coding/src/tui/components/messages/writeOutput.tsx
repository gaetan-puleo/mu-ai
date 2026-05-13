import { Box, Text } from 'ink';
import { useTheme } from '../../theme/ThemeContext';

export function WriteOutput({ args, content, error }: { args: { path?: string }; content: string; error: boolean }) {
  const theme = useTheme();
  return (
    <Box flexDirection="row" borderStyle="single" borderColor={error ? theme.colors.error : theme.colors.border} paddingX={1}>
      <Text color={error ? theme.colors.error : theme.colors.success}>{error ? '✗' : '✓'} write {args.path ?? ''}</Text>
      {content && content !== `File written: ${args.path}` ? <Text dimColor> — {content}</Text> : null}
    </Box>
  );
}
