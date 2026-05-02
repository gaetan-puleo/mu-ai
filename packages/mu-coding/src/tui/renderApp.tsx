import { render } from 'ink';
import type { PluginRegistry } from 'mu-agents';
import type { ChatMessage } from 'mu-provider';
import type { ShutdownFn } from '../app/shutdown';
import type { AppConfig } from '../config/index';
import type { HostMessageBus } from '../runtime/messageBus';
import { ChatPanel } from './components/chat/ChatPanel';
import { ThemeProvider } from './context/ThemeContext';
import type { InkUIService } from './plugins/InkUIService';
import { resolveTheme } from './theme';

interface RenderAppOptions {
  config: AppConfig;
  initialMessages?: ChatMessage[];
  registry: PluginRegistry;
  messageBus: HostMessageBus;
  uiService: InkUIService;
  shutdown: ShutdownFn;
}

export function renderApp(options: RenderAppOptions): void {
  const theme = resolveTheme(options.config.theme);
  render(
    <ThemeProvider theme={theme}>
      <ChatPanel
        config={options.config}
        initialMessages={options.initialMessages}
        registry={options.registry}
        messageBus={options.messageBus}
        uiService={options.uiService}
        shutdown={options.shutdown}
      />
    </ThemeProvider>,
    {
      exitOnCtrlC: false,
      kittyKeyboard: { mode: 'enabled' },
    },
  );
}
