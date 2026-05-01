import type { PluginRegistry } from 'mu-agents';
import type { ChatMessage, ProviderConfig } from 'mu-provider';
import type { ShutdownFn } from '../../../app/shutdown';
import { ChatContext } from '../../chat/ChatContext';
import { ToolDisplayProvider, useToolDisplayMap } from '../../chat/ToolDisplayContext';
import { useChatPanel } from '../../chat/useChatPanel';
import type { InkUIService } from '../../plugins/InkUIService';
import { ChatPanelBody } from './ChatPanelBody';

export function ChatPanel({
  config,
  initialMessages,
  registry,
  uiService,
  shutdown,
}: {
  config: ProviderConfig;
  initialMessages?: ChatMessage[];
  registry: PluginRegistry;
  uiService?: InkUIService;
  shutdown?: ShutdownFn;
}) {
  const { ctx, bodyProps } = useChatPanel({ config, initialMessages, registry, uiService, shutdown });
  const toolDisplays = useToolDisplayMap(registry);

  return (
    <ChatContext.Provider value={ctx}>
      <ToolDisplayProvider value={toolDisplays}>
        <ChatPanelBody {...bodyProps} />
      </ToolDisplayProvider>
    </ChatContext.Provider>
  );
}
