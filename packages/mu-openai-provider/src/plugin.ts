import type { Plugin, Provider } from 'mu-core';
import { listModels } from './models';
import { streamChat } from './stream';

export interface OpenAIProviderPluginConfig {
  /** Optional override id; defaults to `'openai'`. */
  id?: string;
}

/**
 * Wraps the official `openai` Node SDK as a `Provider` consumed by `runAgent`
 * via the host's `ProviderRegistry`. The plugin keeps the SDK as a direct
 * dependency on purpose — we don't reimplement SSE framing, tool-call
 * accumulation, retry, or auth. Hosts pulling in this plugin pay for the SDK
 * (~few hundred kB); hosts that need a leaner, SDK-free path can publish
 * their own provider via `mu-core`'s generic `Provider` interface (or via
 * `createProvider(adapter)` for OpenAI-compat servers without a SDK).
 */
export function createOpenAIProviderPlugin(config: OpenAIProviderPluginConfig = {}): Plugin {
  const provider: Provider = {
    id: config.id ?? 'openai',
    // Wrap with explicit arrow forms so the optional `options?` of the
    // standalone `streamChat` aligns with the `Provider.streamChat`
    // contract (which requires `options`). The SDK ignores extras, the
    // wrapper makes the assignability explicit for the type checker.
    streamChat: (messages, cfg, model, options) => streamChat(messages, cfg, model, options),
    listModels: (cfg) => listModels(cfg.baseUrl),
  };
  return {
    name: 'mu-openai-provider',
    version: '0.5.0',
    activate(ctx) {
      ctx.providers?.register(provider);
    },
  };
}

// Default export so hosts can `import openai from 'mu-openai-provider'`.
export default createOpenAIProviderPlugin;
