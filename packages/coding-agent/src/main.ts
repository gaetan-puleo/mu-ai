import { getConfigPath, loadConfig, loadState, saveState } from './config';
import { createAgentRuntime } from './runtime';
import { ChatApp } from './ui/ChatApp';

export async function main(): Promise<void> {
  const config = loadConfig();
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

  if (!config.baseUrl) {
    throw new Error(
      `Missing baseUrl in config. Create ${getConfigPath()} with { "kind": "llama-swap", "baseUrl": "http://..." }`,
    );
  }

  const agent = await createAgentRuntime({
    kind: config.kind,
    baseUrl: config.baseUrl,
    model: state.model,
    plugins: config.plugins,
    provider: config.provider,
    onModelChange: (model) => savePartialState({ model }),
  });

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
