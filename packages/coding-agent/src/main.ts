import process from 'node:process';
import {
  type AgentControl,
  type AgentSession,
  type ApprovalManager,
  ChatApp,
  type Harness,
  inProcessChatHost,
} from './harness';
import { listLocalModels } from 'mu-local-provider';
import { appendHistory, type CodingAgentState, loadHistory, type ModelCapabilities, saveState } from './config';

export type { AgentControl };

export interface RunAppOptions {
  harness: Harness;
  session: AgentSession;
  approvals: ApprovalManager;
  providerConfig: { kind?: string; baseUrl?: string; apiKey?: string };
  state: CodingAgentState;
  agent: AgentControl;
  capabilities?: ModelCapabilities;
}

/**
 * Run the interactive coding agent as an in-process TUI. The TUI is a direct view
 * over the harness session — no channel bus. Autonomous/multi-transport hosts
 * (e.g. arya) own their channel layer separately; the terminal never was a channel.
 */
export async function runApp(opts: RunAppOptions): Promise<void> {
  const { harness, approvals, state } = opts;

  let app: ChatApp | undefined;
  let shuttingDown = false;
  const shutdown = async (code: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await app?.stop();
    harness.close();
    process.exit(code);
  };

  const chatHost = inProcessChatHost(harness, approvals, {
    session: opts.session,
    cwd: harness.cwd,
    listModels: () => listLocalModels(opts.providerConfig),
    agent: opts.agent,
    capabilities: opts.capabilities,
    initialTheme: state.theme ?? 'dark',
    saveTheme: (name) => {
      state.theme = name;
      saveState(state);
    },
    initialThinking: state.thinkingVisible ?? false,
    saveThinking: (visible) => {
      state.thinkingVisible = visible;
      saveState(state);
    },
    onModelSelected: (ref) => {
      state.model = ref;
      saveState(state);
    },
    history: { load: loadHistory, append: appendHistory },
    onExit: (code) => void shutdown(code),
  });

  process.on('SIGINT', () => void shutdown(130));
  process.on('SIGTERM', () => void shutdown(143));

  app = new ChatApp(chatHost);
  await app.start();
}
