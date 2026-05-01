import { type DOMElement as InkDOMElement, useInput } from 'ink';
import type { PluginRegistry } from 'mu-agents';
import type { ChatMessage, ProviderConfig } from 'mu-provider';
import { useEffect, useMemo, useRef } from 'react';
import type { ShutdownFn } from '../../app/shutdown';
import type { ChatPanelBodyProps } from '../components/chat/ChatPanelBody';
import { useToast } from '../components/primitives/toast';
import { useScroll } from '../hooks/useScroll';
import { useMeasure, useTerminalSize } from '../hooks/useTerminal';
import type { InkUIService, ToastRequest } from '../plugins/InkUIService';
import { useChat } from './useChat';
import { usePluginStatus } from './usePluginStatus';
import { useStatusSegments } from './useStatusSegments';

const TOAST_LEVEL_COLORS: Record<string, string> = {
  info: 'cyan',
  success: 'green',
  warning: 'yellow',
  error: 'red',
};

interface UseChatPanelOptions {
  config: ProviderConfig;
  initialMessages?: ChatMessage[];
  registry: PluginRegistry;
  uiService?: InkUIService;
  shutdown?: ShutdownFn;
}

export function useChatPanel(options: UseChatPanelOptions) {
  const { config, initialMessages, registry, uiService, shutdown } = options;
  const ctx = useChat(config, registry, initialMessages, shutdown);
  const { width, height } = useTerminalSize();
  const viewRef = useRef<InkDOMElement>(null);
  const contentRef = useRef<InkDOMElement>(null);
  // The composite key only needs to change when content visible to the layout
  // shifts: number of messages or active stream length. Mapping over every
  // message's content per render was O(n) wasted work.
  const measureKey = useMemo(
    () =>
      [ctx.session.messages.length, ctx.session.stream.text.length, ctx.session.stream.reasoning?.length ?? 0].join(
        '|',
      ),
    [ctx.session.messages.length, ctx.session.stream.text.length, ctx.session.stream.reasoning?.length],
  );
  const { viewHeight, contentHeight } = useMeasure(viewRef, contentRef, measureKey);
  const { scrollOffset, onScrollUp, onScrollDown } = useScroll(contentHeight, viewHeight);
  const anyModalOpen = ctx.toggles.showModelPicker || ctx.toggles.showSessionPicker;
  const pluginStatus = usePluginStatus(registry, uiService);
  const { toasts, show, dismiss } = useToast();

  useInput((input, key) => key.ctrl && input === 'c' && ctx.abort.onCtrlC(), { isActive: anyModalOpen });

  useEffect(() => {
    if (!uiService) return;
    return uiService.onToast((toast: ToastRequest) => {
      show(toast.message, TOAST_LEVEL_COLORS[toast.level] ?? 'white');
    });
  }, [uiService, show]);

  const statusSegments = useStatusSegments({
    streaming: ctx.session.streaming,
    abortWarning: ctx.abort.abortWarning,
    quitWarning: ctx.abort.quitWarning,
    error: ctx.session.error,
    modelError: ctx.models.modelError,
    tokensPerSecond: ctx.session.stream.tps,
    pluginStatus,
  });

  const bodyProps: ChatPanelBodyProps = {
    width,
    height,
    viewRef,
    contentRef,
    scrollOffset,
    viewHeight,
    contentHeight,
    isActive: !anyModalOpen,
    onScrollUp,
    onScrollDown,
    uiService,
    messages: ctx.session.messages,
    streaming: ctx.session.streaming,
    stream: ctx.session.stream,
    error: ctx.session.error,
    onSubmit: ctx.session.onSend,
    model: ctx.models.currentModel,
    history: ctx.session.inputHistory,
    statusSegments,
    toasts,
    onDismissToast: dismiss,
  };

  return { ctx, bodyProps };
}
