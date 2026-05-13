import { Box, Text } from 'ink';
import type { Message } from 'mu-core';
import { useTheme } from '../../theme/ThemeContext';

export function UserMessage({ message }: { message: Message }) {
  const theme = useTheme();
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={theme.colors.user}>{theme.badges.user}</Text>
      <Text>{message.content}</Text>
    </Box>
  );
}
