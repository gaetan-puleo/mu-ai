import { render } from 'ink';
import type { PluginRegistry } from 'mu-agents';
import type { ChatMessage, ProviderConfig } from 'mu-provider';
import type { ShutdownFn } from '../app/shutdown';
import { ChatPanel } from './components/chat/ChatPanel';
import type { InkUIService } from './plugins/InkUIService';

interface RenderAppOptions {
  config: ProviderConfig;
  initialMessages?: ChatMessage[];
  registry: PluginRegistry;
  uiService: InkUIService;
  shutdown: ShutdownFn;
}

export function renderApp(options: RenderAppOptions): void {
  render(
    <ChatPanel
      config={options.config}
      initialMessages={options.initialMessages}
      registry={options.registry}
      uiService={options.uiService}
      shutdown={options.shutdown}
    />,
    {
      exitOnCtrlC: false,
      kittyKeyboard: { mode: 'enabled' },
    },
  );
}
