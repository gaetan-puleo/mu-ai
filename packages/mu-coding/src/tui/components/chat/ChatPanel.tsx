import type { SubagentRunRegistry } from 'mu-agents';
import type { ChatMessage, PluginRegistry, ProviderConfig, SessionManager, SessionStore, SubmitTextInput, SubmitTextResult } from 'mu-core';
import type { ShutdownFn } from '../../../app/shutdown';
import { ChatContext } from '../../chat/ChatContext';
import { MessageRendererProvider, useRegistryRenderers } from '../../chat/MessageRendererContext';
import { ToolDisplayProvider, useToolDisplayMap } from '../../chat/ToolDisplayContext';
import { useChatPanel } from '../../chat/useChatPanel';
import type { InkUIService } from '../../plugins/InkUIService';
import { ChatPanelBody } from './ChatPanelBody';

export function ChatPanel({
  config,
  initialSessionId,
  initialMessages,
  registry,
  sessions,
  store,
  submitText,
  uiService,
  shutdown,
  subagentRuns,
}: {
  config: ProviderConfig;
  initialSessionId: string;
  initialMessages?: ChatMessage[];
  registry: PluginRegistry;
  sessions: SessionManager;
  store: SessionStore;
  submitText: (input: SubmitTextInput) => Promise<SubmitTextResult>;
  uiService?: InkUIService;
  shutdown?: ShutdownFn;
  subagentRuns?: SubagentRunRegistry;
}) {
  const { ctx, bodyProps } = useChatPanel({
    config,
    initialSessionId,
    initialMessages,
    registry,
    sessions,
    store,
    submitText,
    uiService,
    shutdown,
    subagentRuns,
  });
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
