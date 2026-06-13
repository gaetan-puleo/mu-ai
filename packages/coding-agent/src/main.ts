import process from 'node:process';
import { type AgentSession, type ApprovalManager, ChatApp, type ChatHost, type Harness } from 'mu-harness';
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
}

export async function runApp(opts: RunAppOptions): Promise<void> {
  const { harness, providerConfig, state, agent, capabilities } = opts;

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
    runCommand: (input) => harness.commands.run(input),
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
    features: { vision: capabilities?.vision === true, audio: capabilities?.audio === true },
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
