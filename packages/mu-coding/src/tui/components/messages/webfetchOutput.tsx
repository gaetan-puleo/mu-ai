import { Box, Text } from 'ink';
import { useTheme } from '../../theme/ThemeContext';

export function WebfetchOutput({ args, content, error }: { args: { url?: string }; content: string; error: boolean }) {
  const theme = useTheme();
  if (error) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor={theme.colors.error} paddingX={1}>
        <Text color={theme.colors.error}>webfetch failed</Text>
        <Text>{content.slice(0, 300)}</Text>
      </Box>
    );
  }
  // Hide huge bodies; show URL + size only.
  const bytes = content.length;
  const human = bytes > 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
  return (
    <Box flexDirection="row" borderStyle="single" borderColor={theme.colors.border} paddingX={1}>
      <Text dimColor>webfetch {args.url ?? ''} </Text>
      <Text color={theme.colors.muted}>({human})</Text>
    </Box>
  );
}
