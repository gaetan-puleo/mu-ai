import { createProvider, type Plugin } from 'mu-core';
import { openaiAdapter } from './adapter';

export interface OpenAIProviderPluginConfig {
  /** Optional override id; defaults to `'openai'`. */
  id?: string;
}

export function createOpenAIProviderPlugin(config: OpenAIProviderPluginConfig = {}): Plugin {
  return {
    name: 'mu-openai-provider',
    version: '0.5.0',
    activate(ctx) {
      const adapter = config.id ? { ...openaiAdapter, id: config.id } : openaiAdapter;
      ctx.providers?.register(createProvider(adapter));
    },
  };
}

// Default export so hosts can `import openai from 'mu-openai-provider'`.
export default createOpenAIProviderPlugin;
