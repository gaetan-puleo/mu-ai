import { Box, Text } from 'ink';
import type { ChatMessage } from 'mu-core';

const MESSAGE_TYPE_AGENT_SWITCH = 'mu-agent.switch';
const MESSAGE_TYPE_INDICATOR = 'mu-agent.indicator';
const MESSAGE_TYPE_SUBAGENT = 'mu-agent.subagent';

export const AGENT_MESSAGE_TYPES = {
  switch: MESSAGE_TYPE_AGENT_SWITCH,
  indicator: MESSAGE_TYPE_INDICATOR,
  subagent: MESSAGE_TYPE_SUBAGENT,
};

/**
 * Render an "agent switched" banner. Uses the new agent's color so the
 * eye instantly tracks the change. The body is the first lines of the
 * agent's system prompt for quick context.
 */
export function AgentSwitchMessage({ msg }: { msg: ChatMessage }) {
  const color = msg.display?.color;
  const badge = msg.display?.badge ?? 'agent';
  return (
    <Box flexDirection="column" flexShrink={0} marginY={1} paddingX={1} borderStyle="round" borderColor={color}>
      <Text color={color} bold={true}>
        ▣ {badge}
      </Text>
      <Text wrap="wrap">{msg.content}</Text>
    </Box>
  );
}

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
