import { Box, Text } from 'ink';
import type { Message } from 'mu-core';
import { Markdown } from '../markdown/render';
import { useTheme } from '../../theme/ThemeContext';
import { ReasoningBlock } from './reasoningBlock';
import { ToolCallBlock } from './toolCallBlock';

export function AssistantMessage({ message }: { message: Message }) {
  const theme = useTheme();
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={theme.colors.assistant}>{theme.badges.assistant}</Text>
      {message.reasoning ? <ReasoningBlock text={message.reasoning} /> : null}
      {message.content ? <Markdown text={message.content} /> : null}
      {message.toolCalls?.map((c) => (
        <ToolCallBlock key={c.id} call={c} />
      ))}
    </Box>
  );
}
