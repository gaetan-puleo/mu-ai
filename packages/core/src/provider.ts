import type { Message } from './types/Message';
import type { LLMResponse, LLMStreamEvent, Tools } from './types/Tool';

export type { Message } from './types/Message';
export type { LLMResponse, LLMStreamEvent, Tools } from './types/Tool';

export type LLMProviderResult = LLMResponse | AsyncIterable<LLMStreamEvent>;

export type LLMProvider = (messages: Message[], tools: Tools) => Promise<LLMProviderResult>;

export type ProviderFactory<Config = unknown> = (config: Config) => LLMProvider;
