import type { ApiModel, ProviderAdapter } from 'mu-core';
import { parseOpenAIChunk, toOpenAIMessages } from './format';

export const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  transport: 'sse',
  buildChatRequest({ messages, config, model, tools }) {
    const body: Record<string, unknown> = {
      model,
      messages: toOpenAIMessages(messages, config),
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      stream: true,
      stream_options: { include_usage: true },
      cache_prompt: true,
    };
    if (tools?.length) {
      body.tools = tools.map((t) => ({ type: 'function', function: t.function }));
    }
    return {
      url: `${config.baseUrl.replace(/\/$/, '')}/chat/completions`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        authorization: 'Bearer sk-local',
      },
      body: JSON.stringify(body),
    };
  },
  parseChatEvent(raw) {
    return parseOpenAIChunk(raw);
  },
  buildModelsRequest({ baseUrl }) {
    return {
      url: `${baseUrl.replace(/\/$/, '')}/models`,
      method: 'GET',
      headers: { accept: 'application/json', authorization: 'Bearer sk-local' },
    };
  },
  parseModelsResponse(body) {
    const data = (body as { data?: Array<{ id: string }> }).data ?? [];
    return data.map((m): ApiModel => ({ id: m.id }));
  },
};
