import type { DOMElement } from 'ink';
import { Box, Text } from 'ink';
import type { StatusSegment } from 'mu-agents';
import type { ChatMessage } from 'mu-provider';
import type React from 'react';
import { useSpinner } from '../hooks/useUI';
import type { StreamState } from '../useChatSession';
import { MessageItem } from './messages/messageItem';
import { StreamingOutput } from './messages/streamingOutput';
import { Dropdown } from './ui/dropdown';
import { Modal } from './ui/modal';

function Scrollbar({
  viewHeight,
  contentHeight,
  scrollOffset,
}: {
  viewHeight: number;
  contentHeight: number;
  scrollOffset: number;
}) {
  if (contentHeight <= viewHeight || viewHeight < 1) {
    return null;
  }
  const maxScroll = contentHeight - viewHeight;
  const ratio = scrollOffset / maxScroll;
  const thumbSize = Math.max(1, Math.round((viewHeight / contentHeight) * viewHeight));
  const thumbPos = Math.round(ratio * (viewHeight - thumbSize));

  const track = Array.from({ length: viewHeight }, (_, i) => (i >= thumbPos && i < thumbPos + thumbSize ? '┃' : '│'));

  return (
    <Box flexDirection="column" flexShrink={0} width={1}>
      <Text>{track.join('')}</Text>
    </Box>
  );
}

export function StatusBar({
  streaming,
  abortWarning,
  quitWarning,
  error,
  modelError,
  totalTokens,
  tokensPerSecond,
  pluginStatus,
}: {
  streaming: boolean;
  abortWarning: boolean;
  quitWarning: boolean;
  error: string | null;
  modelError: string | null;
  totalTokens: number;
  tokensPerSecond: number;
  pluginStatus?: StatusSegment[];
}) {
  const spinner = useSpinner(streaming);
  const segments: Array<{ text: string; color?: string; dim?: boolean }> = [];
  if (streaming) {
    segments.push({ text: `${spinner} generating`, color: 'yellow' });
  }
  if (tokensPerSecond > 0) {
    segments.push({ text: `${tokensPerSecond} tok/s`, dim: true });
  }
  if (abortWarning) {
    segments.push({ text: 'Esc again to stop', color: 'yellow' });
  } else if (quitWarning) {
    segments.push({ text: 'Ctrl+C again to quit', color: 'yellow' });
  } else if (streaming) {
    segments.push({ text: 'Esc to stop', dim: true });
  }
  if (error) {
    segments.push({ text: '⚠ error', color: 'red' });
  }
  if (modelError) {
    segments.push({ text: `⚠ ${modelError}`, color: 'red' });
  }

  if (totalTokens > 0) {
    segments.push({ text: `${formatTokens(totalTokens)} tokens`, dim: true });
  }
  if (pluginStatus) {
    segments.push(...pluginStatus);
  }

  return (
    <Box flexShrink={0} paddingX={1} marginY={1}>
      <Box justifyContent="flex-end" flexGrow={1}>
        {segments.map((seg, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional static list
          <Box key={i}>
            {i > 0 && <Text dimColor={true}> · </Text>}
            <Text color={seg.color} dimColor={seg.dim}>
              {seg.text}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return String(tokens);
}

interface PickerItem {
  label: string;
  value: string;
  description?: string;
}

export function PickerModal({
  visible,
  title,
  items,
  placeholder,
  emptyMessage,
  onSelect,
  onCancel,
}: {
  visible: boolean;
  title: string;
  items: PickerItem[];
  placeholder: string;
  emptyMessage?: string;
  onSelect: (value: string) => void;
  onCancel?: () => void;
}) {
  return (
    <Modal visible={visible} title={title}>
      {items.length === 0 && emptyMessage ? (
        <Text dimColor={true} italic={true}>
          {emptyMessage}
        </Text>
      ) : (
        <Dropdown
          items={items}
          placeholder={placeholder}
          isActive={visible}
          onSelect={(item) => onSelect(item.value)}
          onCancel={onCancel}
        />
      )}
    </Modal>
  );
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
  viewRef: React.RefObject<DOMElement | null>;
  contentRef: React.RefObject<DOMElement | null>;
  messages: ChatMessage[];
  streaming: boolean;
  stream: StreamState;
  error: string | null;
  scrollOffset: number;
  viewHeight: number;
  contentHeight: number;
}) {
  return (
    <Box flexGrow={1} overflow="hidden">
      <Box ref={viewRef} flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        <Box ref={contentRef} flexDirection="column" flexShrink={0} marginTop={-scrollOffset}>
          {messages.map((msg, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: messages have no stable id
            <MessageItem key={i} msg={msg} messages={messages} index={i} />
          ))}
          {streaming && <StreamingOutput currentText={stream.text} currentReasoning={stream.reasoning} />}
          {error && <Text color="red">Error: {error}</Text>}
        </Box>
      </Box>
      <Scrollbar viewHeight={viewHeight} contentHeight={contentHeight} scrollOffset={scrollOffset} />
    </Box>
  );
}
