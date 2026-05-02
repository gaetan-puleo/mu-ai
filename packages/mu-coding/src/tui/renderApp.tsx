import { type Instance, render } from 'ink';
import type { ChatMessage, PluginRegistry } from 'mu-core';
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

/**
 * Renders the chat TUI and returns the Ink `Instance` so callers (the TUI
 * channel, tests) can unmount it explicitly. Ink stays mounted until the
 * caller invokes `instance.unmount()` or the process exits.
 */
export function renderApp(options: RenderAppOptions): Instance {
  const theme = resolveTheme(options.config.theme);
  return render(
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
