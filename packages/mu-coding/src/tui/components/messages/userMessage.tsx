import { Box, Text } from 'ink';
import type { ChatMessage } from 'mu-core';
import { useTheme } from '../../context/ThemeContext';

export function UserMessage({ msg }: { msg: ChatMessage }) {
  const theme = useTheme();
  const borderColor = msg.display?.color ?? theme.user.border;
  const badge = msg.display?.badge;
  const prefix = msg.display?.prefix;
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      marginBottom={1}
      backgroundColor={theme.user.background}
      paddingX={1}
      paddingY={1}
      borderLeft={true}
      borderTop={false}
      borderBottom={false}
      borderRight={false}
      borderColor={borderColor}
      borderStyle="single"
    >
      {badge && (
        <Box>
          <Text color={msg.display?.color} bold={true}>
            {badge.charAt(0).toUpperCase() + badge.slice(1)}
          </Text>
        </Box>
      )}
      {msg.images && msg.images.length > 0 && (
        <Box>
          <Text color={theme.user.attachment}>📷 </Text>
          <Text color={theme.user.attachment}>{msg.images.map((img) => img.name).join(', ')}</Text>
        </Box>
      )}
      <Text wrap="wrap">
        {prefix && <Text color={msg.display?.color}>{prefix}</Text>}
        {msg.content}
      </Text>
    </Box>
  );
}
