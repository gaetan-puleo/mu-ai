import { Box, Text } from 'ink';
import type { Message } from 'mu-core';
import { useTheme } from '../../theme/ThemeContext';
import { Markdown } from '../markdown/render';
import { Spinner } from '../primitives/spinner';
import { MessageItem } from './messageItem';
import { ReasoningBlock } from './reasoningBlock';

export interface MessageListProps {
  messages: Message[];
  streaming?: { content: string; reasoning: string };
}

export function MessageList({ messages, streaming }: MessageListProps) {
  const theme = useTheme();
  return (
    <Box flexDirection="column" flexGrow={1}>
      {messages.map((m) => (
        <MessageItem key={m.id} message={m} transcript={messages} />
      ))}
      {streaming ? (
        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="row">
            <Text color={theme.colors.assistant}>{theme.badges.assistant} </Text>
            <Spinner />
          </Box>
          {streaming.reasoning ? <ReasoningBlock text={streaming.reasoning} /> : null}
          {streaming.content ? <Markdown text={streaming.content} /> : null}
        </Box>
      ) : null}
    </Box>
  );
}
