import type {
  ApiModel,
  ChatMessage,
  ProviderConfig,
  StreamChunk,
  StreamOptions,
  ToolDefinition,
  Usage,
} from '../types/llm';
import { fetchWithIdleTimeout, readNDJSON, readSSE } from './transport';

export interface RequestSpec {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

export interface ChatRequestInput {
  messages: ChatMessage[];
  config: ProviderConfig;
  model: string;
  tools?: ToolDefinition[];
}

export interface ModelsRequestInput {
  baseUrl: string;
  config: ProviderConfig;
}

export type ParsedChatEvent =
  | { kind: 'chunk'; chunk: StreamChunk }
  | { kind: 'usage'; usage: Usage }
  | { kind: 'done' }
  | null;

export interface ProviderAdapter {
  id: string;
  transport: 'sse' | 'ndjson';
  buildChatRequest: (input: ChatRequestInput) => RequestSpec;
  parseChatEvent: (raw: string) => ParsedChatEvent;
  buildModelsRequest: (input: ModelsRequestInput) => RequestSpec;
  parseModelsResponse: (body: unknown) => ApiModel[];
}

export interface Provider {
  id: string;
  streamChat: (
    messages: ChatMessage[],
    config: ProviderConfig,
    model: string,
    options: StreamOptions,
  ) => AsyncIterable<StreamChunk>;
  listModels: (config: ProviderConfig) => Promise<ApiModel[]>;
}

export function createProvider(adapter: ProviderAdapter): Provider {
  return {
    id: adapter.id,
    async *streamChat(messages, config, model, options) {
      const spec = adapter.buildChatRequest({ messages, config, model, tools: options.tools });
      const { response, resetIdle, cancel } = await fetchWithIdleTimeout(
        spec.url,
        { method: spec.method, headers: spec.headers, body: spec.body, signal: options.signal },
        config.streamTimeoutMs,
      );
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        cancel();
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${text}`);
      }
      const lines =
        adapter.transport === 'sse' ? readSSE(response, options.signal) : readNDJSON(response, options.signal);
      try {
        for await (const raw of lines) {
          resetIdle();
          const evt = adapter.parseChatEvent(raw);
          if (!evt) continue;
          if (evt.kind === 'done') break;
          if (evt.kind === 'usage') {
            options.onUsage?.(evt.usage);
            continue;
          }
          if (evt.kind === 'chunk') {
            yield evt.chunk;
          }
        }
      } finally {
        cancel();
      }
    },
    async listModels(config) {
      const spec = adapter.buildModelsRequest({ baseUrl: config.baseUrl, config });
      const res = await fetch(spec.url, { method: spec.method, headers: spec.headers });
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching models`);
      const body = await res.json();
      return adapter.parseModelsResponse(body);
    },
  };
}
