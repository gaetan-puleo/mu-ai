import { Box, Text } from 'ink';
import type { ChatMessage } from 'mu-core';

const MESSAGE_TYPE_INDICATOR = 'mu-agents.indicator';
const MESSAGE_TYPE_SUBAGENT = 'mu-agents.subagent';

export const AGENT_MESSAGE_TYPES = {
  indicator: MESSAGE_TYPE_INDICATOR,
  subagent: MESSAGE_TYPE_SUBAGENT,
};

/**
 * Render a subagent invocation header. Output is dim so it reads as
 * meta-information rather than chat content.
 */
export function SubagentMessage({ msg }: { msg: ChatMessage }) {
  const color = msg.display?.color;
  const badge = msg.display?.badge ?? 'subagent';
  return (
    <Box flexDirection="column" flexShrink={0} marginY={1} paddingX={1}>
      <Text color={color} bold={true}>
        ↳ {badge}
      </Text>
      <Text wrap="wrap" dimColor={true}>
        {msg.content}
      </Text>
    </Box>
  );
}

/** Compact agent indicator pinned above the input — single line. */
export function AgentIndicatorMessage({ msg }: { msg: ChatMessage }) {
  const color = msg.display?.color;
  return (
    <Box flexShrink={0} paddingX={1}>
      <Text color={color} bold={true}>
        ▣ {msg.content}
      </Text>
    </Box>
  );
}
