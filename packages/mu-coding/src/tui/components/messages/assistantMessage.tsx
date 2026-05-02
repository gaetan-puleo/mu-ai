import { Box, Text } from 'ink';
import type { ChatMessage } from 'mu-provider';
import React from 'react';
import { ReasoningBlock } from './reasoningBlock';
import { ToolCallBlock } from './toolCallBlock';

export const AssistantMessage: React.FC<{
  msg: ChatMessage;
  toolMessages?: ChatMessage[];
}> = React.memo(function AssistantMessage({ msg, toolMessages }) {
  const badge = msg.display?.badge;
  const prefix = msg.display?.prefix;
  const color = msg.display?.color;
  return (
    <Box flexDirection="column" flexShrink={0} marginBottom={1}>
      {badge && (
        <Box marginBottom={1}>
          <Text color={color} bold={true}>
            [{badge}]
          </Text>
        </Box>
      )}
      {msg.reasoning && <ReasoningBlock reasoning={msg.reasoning} />}
      {msg.toolCalls?.length ? (
        <Box flexDirection="column" marginBottom={1}>
          {msg.toolCalls.map((tc, i) => (
            <ToolCallBlock key={tc.id} toolCall={tc} toolMsg={toolMessages?.[i]} />
          ))}
        </Box>
      ) : null}
      {msg.content && (
        <Text wrap="wrap" color={color}>
          {prefix && <Text color={color}>{prefix}</Text>}
          {msg.content}
        </Text>
      )}
    </Box>
  );
});
