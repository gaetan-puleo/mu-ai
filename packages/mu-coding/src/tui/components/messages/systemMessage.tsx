import { Box, Text } from 'ink';
import type { Message } from 'mu-core';
import { useTheme } from '../../theme/ThemeContext';

export function SystemMessage({ message }: { message: Message }) {
  const theme = useTheme();
  if (message.meta?.visibility === 'llm') return null;
  return (
    <Box flexDirection="row" marginBottom={1}>
      <Text color={theme.colors.system}>{theme.badges.system} </Text>
      <Text dimColor>{message.content}</Text>
    </Box>
  );
}
