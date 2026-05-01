import { Box, type DOMElement as InkDOMElement } from 'ink';
import type { StatusSegment } from 'mu-agents';
import { useEffect, useState } from 'react';
import { useChatContext } from '../../context/chat';
import type { InkUIService, ToastRequest } from '../../services/uiService';
import { MessageView, StatusBar } from '../chatLayout';
import { InputBox } from '../inputBox';
import { DialogLayer } from '../ui/dialogLayer';
import { ToastContainer, useToast } from '../ui/toast';
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

const TOAST_LEVEL_COLORS: Record<string, string> = {
  info: 'cyan',
  success: 'green',
  warning: 'yellow',
  error: 'red',
};

export function ChatPanelBody(props: LayoutProps & { uiService?: InkUIService }) {
  const { session, models, abort, registry } = useChatContext();
  const [pluginStatus, setPluginStatus] = useState<StatusSegment[]>([]);
  const { toasts, show, dismiss } = useToast();

  useEffect(() => {
    if (!props.uiService) return;
    props.uiService.onToast((toast: ToastRequest) => {
      show(toast.message, TOAST_LEVEL_COLORS[toast.level] ?? 'white');
    });
  }, [props.uiService, show]);

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
      {props.uiService && <DialogLayer service={props.uiService} />}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </Box>
  );
}
