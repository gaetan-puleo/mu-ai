import type { ChatMessage, PluginRegistry, ProviderConfig } from 'mu-core';
import type { ShutdownFn } from '../../../app/shutdown';
import type { HostMessageBus } from '../../../runtime/messageBus';
import { ChatContext } from '../../chat/ChatContext';
import { MessageRendererProvider, useRegistryRenderers } from '../../chat/MessageRendererContext';
import { ToolDisplayProvider, useToolDisplayMap } from '../../chat/ToolDisplayContext';
import { useChatPanel } from '../../chat/useChatPanel';
import type { InkUIService } from '../../plugins/InkUIService';
import { ChatPanelBody } from './ChatPanelBody';

export function ChatPanel({
  config,
  initialMessages,
  registry,
  messageBus,
  uiService,
  shutdown,
}: {
  config: ProviderConfig;
  initialMessages?: ChatMessage[];
  registry: PluginRegistry;
  messageBus?: HostMessageBus;
  uiService?: InkUIService;
  shutdown?: ShutdownFn;
}) {
  const { ctx, bodyProps } = useChatPanel({ config, initialMessages, registry, messageBus, uiService, shutdown });
  const toolDisplays = useToolDisplayMap(registry);
  const renderers = useRegistryRenderers(registry);

  return (
    <ChatContext.Provider value={ctx}>
      <ToolDisplayProvider value={toolDisplays}>
        <MessageRendererProvider value={renderers}>
          <ChatPanelBody {...bodyProps} />
        </MessageRendererProvider>
      </ToolDisplayProvider>
    </ChatContext.Provider>
  );
}
