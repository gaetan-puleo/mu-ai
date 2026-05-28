import type { LLMResponse, LLMStreamEvent } from './types/LLM';
import type { Message } from './types/Message';
import type { Tools } from './types/Tool';

export type LLMProviderResult = LLMResponse | AsyncIterable<LLMStreamEvent>;

export type LLMProvider = (messages: Message[], tools: Tools) => Promise<LLMProviderResult>;
