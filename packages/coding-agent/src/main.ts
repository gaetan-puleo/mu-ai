import process from 'node:process';
import {
  type AgentSession,
  type ApprovalManager,
  ChatApp,
  type ChatHost,
  type Harness,
  type VoiceTranscriber,
} from 'mu-harness';
import { listLocalModels } from 'mu-local-provider';
import { appendHistory, type CodingAgentState, loadHistory, type ModelCapabilities, saveState } from './config';

export interface AgentControl {
  ref(): string;
  color(): string | undefined;
  cycle(): string;
  primaryNames(): string[];
}

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

export async function runApp(opts: RunAppOptions): Promise<void> {
  const { harness, providerConfig, state, agent, capabilities } = opts;

  // In-process equivalent of the WS channel's model_loading broadcast: selecting a
  // model probes its modalities (which loads it), and we surface that as a spinner.
  const modelLoadingListeners = new Set<(model: string, loading: boolean) => void>();
  const emitModelLoading = (model: string, loading: boolean): void => {
    for (const l of [...modelLoadingListeners]) l(model, loading);
  };

  // Mutable so a /props probe can refine it live; ChatApp reads this same object.
  const features = { vision: capabilities?.vision === true, audio: capabilities?.audio === true };

  const host: ChatHost = {
    session: opts.session,
    approvals: opts.approvals,
    cwd: harness.cwd,
    createSession: () => harness.sessions.create(),
    forkSession: (id, upToIndex) => harness.sessions.fork(id, upToIndex),
    listSessions: () => harness.sessions.list({ cwd: harness.cwd }),
    openSession: (id) => harness.sessions.open(id),
    selectModel: (ref) => {
      harness.models.select(ref);
      state.model = ref;
      saveState(state);
      // Probe the new model (loads it) behind a spinner, mirroring the WS channel,
      // and refine the image/audio capabilities from its /props.modalities.
      emitModelLoading(ref, true);
      void harness.models.capabilities(ref)
        .then((mods) => {
          if (mods) {
            features.vision = mods.vision;
            features.audio = mods.audio;
          }
        })
        .catch(() => undefined)
        .finally(() => emitModelLoading(ref, false));
    },
    subscribeModelLoading: (listener) => {
      modelLoadingListeners.add(listener);
      return () => modelLoadingListeners.delete(listener);
    },
    modelRef: () => harness.models.selected,
    listModels: () => listLocalModels(providerConfig),
    agentRef: () => agent.ref(),
    agentColor: () => agent.color(),
    cycleAgent: () => agent.cycle(),
    agentNames: () => {
      const primary = new Set(agent.primaryNames());
      return harness.agents.list().map((a) => a.name).filter((name) => name !== 'title' && !primary.has(name));
    },
    subAgents: harness.subAgents,
    dispatchSubAgent: (agent, task, parentId) => harness.dispatchSubAgent(agent, task, parentId),
    commands: () => harness.commands.list().map((c) => ({ name: c.name, description: c.description })),
    runCommand: (input, ctx) => harness.commands.run(input, { session: ctx?.session }),
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
    history: { load: loadHistory, append: appendHistory },
    features,
    voice: opts.voice,
    onExit: (code) => {
      harness.close();
      process.exit(code);
    },
  };

  const app = new ChatApp(host);

  process.on('SIGINT', () => void app.stop().then(() => process.exit(130)));
  process.on('SIGTERM', () => void app.stop().then(() => process.exit(143)));

  await app.start();
}
