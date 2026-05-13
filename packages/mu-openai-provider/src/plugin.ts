import type { Plugin, Provider } from 'mu-core';
import { streamChat } from './stream';

export interface OpenAIProviderPluginConfig {
  /** Optional override id; defaults to `'openai'`. */
  id?: string;
}

/**
 * Wraps the official `openai` Node SDK as a `Provider`. The plugin keeps the
 * SDK as a direct dependency — we don't reimplement SSE framing, tool-call
 * accumulation, retry, or auth. Hosts that need a leaner path can publish
 * their own provider via mu-core's generic `Provider` interface.
 */
export function createOpenAIProviderPlugin(config: OpenAIProviderPluginConfig = {}): Plugin {
  const provider: Provider = {
    id: config.id ?? 'openai',
    streamChat,
  };
  return {
    name: 'mu-openai-provider',
    register(api) {
      api.provider(provider);
    },
  };
}

export default createOpenAIProviderPlugin;
