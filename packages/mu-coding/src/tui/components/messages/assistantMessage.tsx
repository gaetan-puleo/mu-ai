import { Box, Text } from 'ink';
import type { ChatMessage } from 'mu-provider';
import React from 'react';
import { ReasoningBlock } from './reasoningBlock';
import { ToolCallBlock } from './toolCallBlock';

export const AssistantMessage: React.FC<{
  msg: ChatMessage;
  toolMessages?: ChatMessage[];
}> = React.memo(function AssistantMessage({ msg, toolMessages }) {
  return (
    <Box flexDirection="column" flexShrink={0} marginBottom={1}>
      {msg.reasoning && <ReasoningBlock reasoning={msg.reasoning} />}
      {msg.toolCalls?.length ? (
        <Box flexDirection="column" marginBottom={1}>
          {msg.toolCalls.map((tc, i) => (
            <ToolCallBlock key={tc.id} toolCall={tc} toolMsg={toolMessages?.[i]} />
          ))}
        </Box>
      ) : null}
      {msg.content && <Text wrap="wrap">{msg.content}</Text>}
    </Box>
  );
});
