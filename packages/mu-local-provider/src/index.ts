// Convenience re-exports of the mu-core LLM types used by hosts that drive
// the provider directly (ad-hoc scripts, tests).
export type {
  Message,
  ProviderConfig,
  StreamChunk,
  StreamOptions,
  ToolCall,
  ToolResultInfo,
  Usage,
} from 'mu-core';

export {
  clearDetectionCache,
  detectServer,
  type LocalServerInfo,
  type LocalServerKind,
  originRoot,
} from './detect';
export {
  bareModelId,
  formatModelId,
  type ParsedModelId,
  PROVIDER_PREFIX,
  parseModelId,
} from './modelId';
export { type ApiModel, getModelInfo, type LocalModelInfo, listModels } from './models';
export {
  createLocalProviderPlugin,
  default,
  type LocalProviderHandle,
  type LocalProviderPlugin,
  type LocalProviderPluginConfig,
} from './plugin';
export { streamChat } from './stream';
