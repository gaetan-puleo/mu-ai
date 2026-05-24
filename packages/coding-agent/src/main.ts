import { loadState, saveState } from './config';
import type { AgentRuntime } from './runtime';
import { ChatApp } from './ui/ChatApp';

export async function main(agent: AgentRuntime): Promise<void> {
  const state = loadState();

  const savePartialState = (patch: typeof state): void => {
    Object.assign(state, patch);
    try {
      saveState(state);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[coding-agent] failed to save state: ${msg}\n`);
    }
  };

  agent.setModel(state.model ?? agent.model);

  const app = new ChatApp(agent.runtime, agent.bus, agent, (code) => process.exit(code), {
    thinkingVisible: state.thinkingVisible,
    onThinkingVisibleChange: (thinkingVisible) => savePartialState({ thinkingVisible }),
  });

  process.on('SIGINT', () => {
    void app.stop().then(() => process.exit(130));
  });
  process.on('SIGTERM', () => {
    void app.stop().then(() => process.exit(143));
  });

  await app.start();
}
