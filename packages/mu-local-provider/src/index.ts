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
export { type ApiModel, getModelInfo, listModels, type LocalModelInfo } from './models';
export {
  bareModelId,
  formatModelId,
  parseModelId,
  type ParsedModelId,
  PROVIDER_PREFIX,
} from './modelId';
export {
  createLocalProviderPlugin,
  default,
  type LocalProviderHandle,
  type LocalProviderPlugin,
  type LocalProviderPluginConfig,
} from './plugin';
export { streamChat } from './stream';
