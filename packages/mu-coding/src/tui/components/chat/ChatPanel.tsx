import { type DOMElement as InkDOMElement, useInput } from 'ink';
import type { PluginRegistry } from 'mu-agents';
import type { ChatMessage, ProviderConfig } from 'mu-provider';
import { useRef } from 'react';
import { ChatContext } from '../../context/chat';
import { useScroll } from '../../hooks/useScroll';
import { useMeasure, useTerminalSize } from '../../hooks/useTerminal';
import type { InkUIService } from '../../services/uiService';
import { useChat } from '../../useChat';
import { ChatPanelBody } from './ChatPanelBody';

export function ChatPanel({
  config,
  initialMessages,
  registry,
  uiService,
}: {
  config: ProviderConfig;
  initialMessages?: ChatMessage[];
  registry: PluginRegistry;
  uiService?: InkUIService;
}) {
  const ctx = useChat(config, registry, initialMessages);
  const { width, height } = useTerminalSize();
  const viewRef = useRef<InkDOMElement>(null);
  const contentRef = useRef<InkDOMElement>(null);
  const { viewHeight, contentHeight } = useMeasure(
    viewRef,
    contentRef,
    [
      ctx.session.messages.length,
      ...ctx.session.messages.map((m) => m.content.length),
      ctx.session.stream.text.length,
      ctx.session.stream.reasoning?.length ?? 0,
    ].join('|'),
  );
  const { scrollOffset, onScrollUp, onScrollDown } = useScroll(contentHeight, viewHeight);

  const anyModalOpen = ctx.toggles.showModelPicker || ctx.toggles.showSessionPicker;
  useInput((input, key) => key.ctrl && input === 'c' && ctx.abort.onCtrlC(), { isActive: anyModalOpen });

  return (
    <ChatContext.Provider value={ctx}>
      <ChatPanelBody
        width={width}
        height={height}
        viewRef={viewRef}
        contentRef={contentRef}
        scrollOffset={scrollOffset}
        viewHeight={viewHeight}
        contentHeight={contentHeight}
        isActive={!anyModalOpen}
        onScrollUp={onScrollUp}
        onScrollDown={onScrollDown}
        uiService={uiService}
      />
    </ChatContext.Provider>
  );
}
