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
// SDK-based entry points. Hosts driving the plugin path use the registered
// Provider; these direct exports remain useful for ad-hoc scripts and tests
// that want to call OpenAI without going through the registry.
export { fetchModelContextLimit, listModels } from './models';
export { createOpenAIProviderPlugin, default, type OpenAIProviderPluginConfig } from './plugin';
export { streamChat } from './stream';
