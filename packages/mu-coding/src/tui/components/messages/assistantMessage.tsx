import { Box, Text } from 'ink';
import type { ChatMessage } from 'mu-core';
import React from 'react';
import { MarkdownContent } from './markdown';
import { ReasoningBlock } from './reasoningBlock';
import { ToolCallBlock } from './toolCallBlock';

/**
 * Tool names whose calls are already represented in the transcript by the
 * `mu-agents.subagent` custom message renderer (`SubagentMessage`).
 * Filtering them out here prevents a redundant `✓ subagent` block from
 * rendering the same body the SubagentMessage already shows.
 *
 * Reload caveat: the `SubagentRunRegistry` is in-memory only, so after a
 * session reload the SubagentMessage block has no live run and shows
 * just the `↳ <name>` glyph without a body. The wrapped tool result
 * still lives in the persisted transcript (and the LLM payload), so the
 * parent agent's relay paragraph is intact; the user just can't see the
 * raw subagent output inline after reopening the session. Accepted
 * trade-off; revisit if/when run hydration is wired into reload.
 */
const SUBAGENT_TOOL_NAMES = new Set(['subagent', 'subagent_parallel']);

export const AssistantMessage: React.FC<{
  msg: ChatMessage;
  toolMessages?: ChatMessage[];
}> = React.memo(function AssistantMessage({ msg, toolMessages }) {
  const badge = msg.display?.badge;
  const prefix = msg.display?.prefix;
  const color = msg.display?.color;

  // Filter subagent tool calls out of the visible list, dropping their
  // matching `toolMessages` entries in lock-step so positional indexing
  // stays correct for the surviving calls.
  const visibleEntries = (msg.toolCalls ?? []).flatMap((tc, i) =>
    SUBAGENT_TOOL_NAMES.has(tc.function.name) ? [] : [{ tc, toolMsg: toolMessages?.[i] }],
  );

  // If every renderable surface on this assistant message is empty after
  // filtering, suppress the entire block — otherwise we'd render a
  // dangling badge bubble for assistant turns that were nothing but a
  // subagent dispatch.
  const hasAnything = visibleEntries.length > 0 || !!msg.content || !!msg.reasoning;
  if (!hasAnything) return null;

  const hasVisibleToolCalls = visibleEntries.length > 0;
  return (
    <Box flexDirection="column" flexShrink={0} marginBottom={hasVisibleToolCalls ? 0 : 1}>
      {badge && (
        <Box>
          <Text color={color} bold={true}>
            {badge.charAt(0).toUpperCase() + badge.slice(1)}
          </Text>
        </Box>
      )}
      {msg.reasoning && <ReasoningBlock reasoning={msg.reasoning} />}
      {hasVisibleToolCalls ? (
        <Box flexDirection="column">
          {visibleEntries.map(({ tc, toolMsg }) => (
            <ToolCallBlock key={tc.id} toolCall={tc} toolMsg={toolMsg} />
          ))}
        </Box>
      ) : null}
      {msg.content && (
        <Box flexDirection="column">
          {prefix && <Text color={color}>{prefix}</Text>}
          <MarkdownContent content={msg.content} color={color} />
        </Box>
      )}
    </Box>
  );
});
