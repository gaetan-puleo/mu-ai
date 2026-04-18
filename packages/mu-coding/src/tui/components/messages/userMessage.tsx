import { Box, Text } from 'ink';
import type { ChatMessage } from 'mu-provider';

export function UserMessage({ msg }: { msg: ChatMessage }) {
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      marginY={1}
      backgroundColor="#1a1a1a"
      paddingX={1}
      paddingY={1}
      borderLeft={true}
      borderTop={false}
      borderBottom={false}
      borderRight={false}
      borderColor="yellow"
      borderStyle="single"
    >
      {msg.images && msg.images.length > 0 && (
        <Box>
          <Text color="cyan">📷 </Text>
          <Text color="cyan">{msg.images.map((img) => img.name).join(', ')}</Text>
        </Box>
      )}
      <Text wrap="wrap">{msg.content}</Text>
    </Box>
  );
}
