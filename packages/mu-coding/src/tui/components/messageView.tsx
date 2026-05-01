import type { DOMElement } from 'ink';
import { Box, Text } from 'ink';
import type { ChatMessage } from 'mu-provider';
import { type RefObject, useMemo } from 'react';
import type { StreamState } from '../chat/useChatSession';
import { MessageItem } from './messages/messageItem';
import { StreamingOutput } from './messages/streamingOutput';
import { Scrollbar } from './primitives/scrollbar';

/**
 * Walk `messages` once and group every assistant-with-tool-calls index to
 * its trailing `tool` messages. Avoids the previous O(n²) scan where each
 * `MessageItem` re-walked the array forward to find its tool replies.
 */
function indexToolMessages(messages: ChatMessage[]): Map<number, ChatMessage[]> {
  const map = new Map<number, ChatMessage[]>();
  let activeAssistant = -1;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      activeAssistant = i;
      map.set(i, []);
    } else if (msg.role === 'tool' && activeAssistant !== -1) {
      map.get(activeAssistant)?.push(msg);
    } else {
      activeAssistant = -1;
    }
  }
  return map;
}

export function MessageView({
  viewRef,
  contentRef,
  messages,
  streaming,
  stream,
  error,
  scrollOffset,
  viewHeight,
  contentHeight,
}: {
  viewRef: RefObject<DOMElement | null>;
  contentRef: RefObject<DOMElement | null>;
  messages: ChatMessage[];
  streaming: boolean;
  stream: StreamState;
  error: string | null;
  scrollOffset: number;
  viewHeight: number;
  contentHeight: number;
}) {
  const toolMessageIndex = useMemo(() => indexToolMessages(messages), [messages]);

  return (
    <Box flexGrow={1} overflow="hidden">
      <Box ref={viewRef} flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        <Box ref={contentRef} flexDirection="column" flexShrink={0} marginTop={-scrollOffset}>
          {messages.map((msg, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: messages have no stable id
            <MessageItem key={i} msg={msg} toolMessages={toolMessageIndex.get(i)} />
          ))}
          {streaming && <StreamingOutput currentText={stream.text} currentReasoning={stream.reasoning} />}
          {error && <Text color="red">Error: {error}</Text>}
        </Box>
      </Box>
      <Scrollbar viewHeight={viewHeight} contentHeight={contentHeight} scrollOffset={scrollOffset} />
    </Box>
  );
}
