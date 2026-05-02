import { Box, Text } from 'ink';
import type { ChatMessage } from 'mu-provider';
import { useTheme } from '../../context/ThemeContext';

export function UserMessage({ msg }: { msg: ChatMessage }) {
  const theme = useTheme();
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      marginY={1}
      backgroundColor={theme.user.background}
      paddingX={1}
      paddingY={1}
      borderLeft={true}
      borderTop={false}
      borderBottom={false}
      borderRight={false}
      borderColor={theme.user.border}
      borderStyle="single"
    >
      {msg.images && msg.images.length > 0 && (
        <Box>
          <Text color={theme.user.attachment}>📷 </Text>
          <Text color={theme.user.attachment}>{msg.images.map((img) => img.name).join(', ')}</Text>
        </Box>
      )}
      <Text wrap="wrap">{msg.content}</Text>
    </Box>
  );
}
