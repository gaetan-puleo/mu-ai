// LLM types live in mu-core. We re-export them for convenience so existing
// consumers `import { ChatMessage } from 'mu-openai-provider'` keep working.
export type {
  ApiModel,
  ChatMessage,
  ImageAttachment,
  MessageDisplay,
  ProviderConfig,
  StreamChunk,
  StreamOptions,
  ToolCall,
  ToolDefinition,
  ToolResultInfo,
  Usage,
} from 'mu-core';
export { openaiAdapter } from './adapter';
export { type OpenAIMessage, parseOpenAIChunk, parseOpenAIUsage, toOpenAIMessages } from './format';
// SDK-based legacy entry points. New hosts should register the plugin via
// `createOpenAIProviderPlugin` and use `runAgent` instead of calling these
// directly — but they remain available for ad-hoc scripts and tests.
export { listModels } from './models';
export { createOpenAIProviderPlugin, default, type OpenAIProviderPluginConfig } from './plugin';
export { streamChat } from './stream';
