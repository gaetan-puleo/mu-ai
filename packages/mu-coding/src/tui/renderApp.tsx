import { type Instance, render } from 'ink';
import { type SubagentRunRegistry, SubagentRunsProvider } from 'mu-agents';
import type { ChatMessage, PluginRegistry } from 'mu-core';
import type { ReactNode } from 'react';
import type { ShutdownFn } from '../app/shutdown';
import type { AppConfig } from '../config/index';
import type { SessionPathHolder } from '../runtime/createRegistry';
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
  sessionPathHolder?: SessionPathHolder;
  subagentRuns?: SubagentRunRegistry;
}

/**
 * Optionally wrap children with the subagent-runs provider so the
 * `↳ subagent` header renderer can subscribe to live status updates.
 * Wrapping is conditional because hosts that disabled the agent plugin
 * have no registry to provide.
 */
function withSubagentProvider(runs: SubagentRunRegistry | undefined, children: ReactNode): ReactNode {
  if (!runs) return <>{children}</>;
  return <SubagentRunsProvider registry={runs}>{children}</SubagentRunsProvider>;
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
      {withSubagentProvider(
        options.subagentRuns,
        <ChatPanel
          config={options.config}
          initialMessages={options.initialMessages}
          registry={options.registry}
          messageBus={options.messageBus}
          uiService={options.uiService}
          shutdown={options.shutdown}
          sessionPathHolder={options.sessionPathHolder}
          subagentRuns={options.subagentRuns}
        />,
      )}
    </ThemeProvider>,
    {
      exitOnCtrlC: false,
      kittyKeyboard: { mode: 'enabled' },
      maxFps: 60,
      incrementalRendering: true,
    },
  );
}
