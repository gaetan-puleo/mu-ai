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

export { type ApiModel, fetchModelContextLimit, listModels } from './models';
export { createOpenAIProviderPlugin, default, type OpenAIProviderPluginConfig } from './plugin';
export { streamChat } from './stream';
