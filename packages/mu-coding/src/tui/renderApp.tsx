import { type Instance, render } from 'ink';
import type { SubagentRunRegistry } from 'mu-agents';
import type { ChatMessage, PluginRegistry, SessionManager, SessionStore, SubmitTextInput, SubmitTextResult } from 'mu-core';
import type { ReactNode } from 'react';
import type { ShutdownFn } from '../app/shutdown';
import type { AppConfig } from '../config/index';
import { ChatPanel } from './components/chat/ChatPanel';
import { ThemeProvider } from './context/ThemeContext';
import type { InkUIService } from './plugins/InkUIService';
import { SubagentRunsProvider } from './SubagentRunsProvider';
import { resolveTheme } from './theme';

interface RenderAppOptions {
  config: AppConfig;
  initialSessionId: string;
  initialMessages?: ChatMessage[];
  registry: PluginRegistry;
  sessions: SessionManager;
  store: SessionStore;
  submitText: (input: SubmitTextInput) => Promise<SubmitTextResult>;
  uiService: InkUIService;
  shutdown: ShutdownFn;
  subagentRuns?: SubagentRunRegistry;
}

function withSubagentProvider(runs: SubagentRunRegistry | undefined, children: ReactNode): ReactNode {
  if (!runs) return <>{children}</>;
  return <SubagentRunsProvider registry={runs}>{children}</SubagentRunsProvider>;
}

export function renderApp(options: RenderAppOptions): Instance {
  const theme = resolveTheme(options.config.theme);
  return render(
    <ThemeProvider theme={theme}>
      {withSubagentProvider(
        options.subagentRuns,
        <ChatPanel
          config={options.config}
          initialSessionId={options.initialSessionId}
          initialMessages={options.initialMessages}
          registry={options.registry}
          sessions={options.sessions}
          store={options.store}
          submitText={options.submitText}
          uiService={options.uiService}
          shutdown={options.shutdown}
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
