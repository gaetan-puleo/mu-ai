/**
 * mu-local-provider plugin entrypoint.
 *
 * Registers a `Provider` with `id: 'local'` whose `streamChat` is the
 * cloned OpenAI SSE path (see `stream.ts`). Alongside the standard
 * plugin surface, exposes a `handle` object so hosts can read sidecar
 * information about the detected local server and discovered model
 * metadata:
 *
 *   handle.getServerInfo()                       → LocalServerInfo
 *   handle.getModelInfo(modelId)                 → LocalModelInfo
 *
 * mu-core has no default `providerId` — hosts MUST set
 * `config.providerId = 'local'` (or whatever override they pass via
 * `LocalProviderPluginConfig.id`) for chat to route through this plugin.
 */

import type { Plugin, Provider } from 'mu-core';
import { detectServer, type LocalServerInfo } from './detect';
import { getModelInfo, type LocalModelInfo } from './models';
import { bareModelId } from './modelId';
import { streamChat as innerStreamChat } from './stream';

export interface LocalProviderPluginConfig {
  /** Optional override id; defaults to `'local'`. */
  id?: string;
}

export interface LocalProviderHandle {
  /** Returns the detected server info for the host's `baseUrl`. Cached. */
  getServerInfo(baseUrl: string): Promise<LocalServerInfo>;
  /** Returns the bare-id + runtime context window when discoverable. */
  getModelInfo(baseUrl: string, modelId: string): Promise<LocalModelInfo>;
}

export interface LocalProviderPlugin extends Plugin {
  handle: LocalProviderHandle;
}

/**
 * Strip our hierarchical `local/<kind>/<id>` prefix off the model field
 * before handing the message to the underlying OpenAI SSE path. The
 * server only knows its bare ids; preserving the routing prefix on the
 * wire would 404.
 */
function adaptStreamChat(): Provider['streamChat'] {
  return (messages, config, options) => {
    const adapted = { ...config, model: config.model ? bareModelId(config.model) : config.model };
    return innerStreamChat(messages, adapted, options);
  };
}

export function createLocalProviderPlugin(
  config: LocalProviderPluginConfig = {},
): LocalProviderPlugin {
  const provider: Provider = {
    id: config.id ?? 'local',
    streamChat: adaptStreamChat(),
  };
  const handle: LocalProviderHandle = {
    getServerInfo: (baseUrl) => detectServer(baseUrl),
    getModelInfo: (baseUrl, modelId) => getModelInfo(baseUrl, modelId),
  };
  return {
    name: 'mu-local-provider',
    register(api) {
      api.provider(provider);
    },
    handle,
  };
}

export default createLocalProviderPlugin;
