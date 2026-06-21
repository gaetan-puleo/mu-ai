import process from 'node:process';
import {
  type AgentControl,
  type AgentSession,
  type ApprovalManager,
  type ChannelHost,
  type Harness,
  runChannels,
  ttyAdapter,
  type VoiceTranscriber,
} from 'mu-harness';
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
  voice?: VoiceTranscriber;
}

/**
 * Run the interactive coding agent as a single TUI adapter on the shared channel
 * host. The TUI is just one adapter of `runChannels`; "autonomous" hosts attach
 * different adapters (e.g. WebSocket) to the same harness.
 */
export async function runApp(opts: RunAppOptions): Promise<void> {
  const { harness, approvals, state } = opts;

  let host: ChannelHost | undefined;
  let shuttingDown = false;
  const shutdown = async (code: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await host?.stop();
    harness.close();
    process.exit(code);
  };

  const tty = ttyAdapter({
    session: opts.session,
    cwd: harness.cwd,
    listModels: () => listLocalModels(opts.providerConfig),
    agent: opts.agent,
    capabilities: opts.capabilities,
    voice: opts.voice,
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

  host = await runChannels({ harness, approvals, adapters: [tty] });

  process.on('SIGINT', () => void shutdown(130));
  process.on('SIGTERM', () => void shutdown(143));
}
