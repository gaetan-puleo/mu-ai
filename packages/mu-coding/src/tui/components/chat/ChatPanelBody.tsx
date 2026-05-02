import { Box, type DOMElement as InkDOMElement } from 'ink';
import type { ChatMessage } from 'mu-core';
import type { StreamState } from '../../chat/useChatSession';
import type { SubagentBrowserState } from '../../chat/useSubagentBrowser';
import { useInputInfoSegments } from '../../hooks/useInputInfoSegments';
import { InputBox } from '../../input/InputBox';
import type { InkUIService } from '../../plugins/InkUIService';
import { MessageView } from '../messageView';
import { type Toast, ToastContainer } from '../primitives/toast';
import type { StatusBarSegment } from '../statusBar';
import { StatusBar } from '../statusBar';
import { DialogLayer } from '../ui/dialogLayer';
import { Pickers } from './Pickers';
import { SubagentBrowserPanel } from './SubagentBrowserPanel';

export interface ChatPanelBodyProps {
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
  uiService?: InkUIService;
  messages: ChatMessage[];
  streaming: boolean;
  stream: StreamState;
  error: string | null;
  onSubmit: (text: string) => void;
  model: string;
  history: string[];
  statusSegments: StatusBarSegment[];
  toasts: Toast[];
  onDismissToast: (id: number) => void;
  /** Subagent browser state — when in subagent mode the chat body is replaced. */
  browser?: SubagentBrowserState;
}

export function ChatPanelBody(props: ChatPanelBodyProps) {
  const infoSegments = useInputInfoSegments();

  // Browser mode: replace the entire chat body with the subagent panel.
  // Modals (dialog layer, toasts) still render so an `ask` triggered by a
  // subagent dispatch can still surface to the user.
  if (props.browser?.mode.kind === 'subagent' && props.browser.currentRun) {
    return (
      <Box flexDirection="column" height={props.height} width={props.width}>
        <SubagentBrowserPanel run={props.browser.currentRun} position={props.browser.position} />
        {props.uiService && <DialogLayer service={props.uiService} />}
        <ToastContainer toasts={props.toasts} onDismiss={props.onDismissToast} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={props.height} width={props.width}>
      <MessageView
        viewRef={props.viewRef}
        contentRef={props.contentRef}
        messages={props.messages}
        streaming={props.streaming}
        stream={props.stream}
        error={props.error}
        scrollOffset={props.scrollOffset}
        viewHeight={props.viewHeight}
        contentHeight={props.contentHeight}
      />
      <InputBox
        onSubmit={props.onSubmit}
        onScrollUp={props.onScrollUp}
        onScrollDown={props.onScrollDown}
        isActive={props.isActive}
        model={props.model}
        history={props.history}
        infoSegments={infoSegments}
      />
      <StatusBar segments={props.statusSegments} />
      <Pickers />
      {props.uiService && <DialogLayer service={props.uiService} />}
      <ToastContainer toasts={props.toasts} onDismiss={props.onDismissToast} />
    </Box>
  );
}
