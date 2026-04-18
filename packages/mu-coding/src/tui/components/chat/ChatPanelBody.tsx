import { Box, type DOMElement as InkDOMElement } from 'ink';
import type { StatusSegment } from 'mu-agents';
import { useEffect, useState } from 'react';
import { useChatContext } from '../../context/chat';
import { MessageView, StatusBar } from '../chatLayout';
import { InputBox } from '../inputBox';
import { Pickers } from './Pickers';

interface LayoutProps {
  width: number;
  height: number;
  viewRef: React.RefObject<InkDOMElement | null>;
  contentRef: React.RefObject<InkDOMElement | null>;
  scrollOffset: number;
  viewHeight: number;
  contentHeight: number;
  isActive: boolean;
  onScrollUp: () => void;
  onScrollDown: () => void;
}

export function ChatPanelBody(props: LayoutProps) {
  const { session, models, abort, registry } = useChatContext();
  const [pluginStatus, setPluginStatus] = useState<StatusSegment[]>([]);

  useEffect(() => {
    const refresh = () => setPluginStatus(registry.getStatusSegments());
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, [registry]);

  return (
    <Box flexDirection="column" height={props.height} width={props.width}>
      <MessageView
        viewRef={props.viewRef}
        contentRef={props.contentRef}
        messages={session.messages}
        streaming={session.streaming}
        stream={session.stream}
        error={session.error}
        scrollOffset={props.scrollOffset}
        viewHeight={props.viewHeight}
        contentHeight={props.contentHeight}
      />
      <InputBox
        onSubmit={session.onSend}
        onScrollUp={props.onScrollUp}
        onScrollDown={props.onScrollDown}
        isActive={props.isActive}
        model={models.currentModel}
        history={session.inputHistory}
      />
      <StatusBar
        streaming={session.streaming}
        abortWarning={abort.abortWarning}
        quitWarning={abort.quitWarning}
        error={session.error}
        modelError={models.modelError}
        totalTokens={session.stream.totalTokens}
        tokensPerSecond={session.stream.tps}
        pluginStatus={pluginStatus}
      />
      <Pickers />
    </Box>
  );
}
