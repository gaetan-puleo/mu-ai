import type { LocalBackendInfo } from '../types';

export interface Backend {
  kind: string;
  detect(config: { baseUrl: string; apiKey?: string }): Promise<LocalBackendInfo | undefined>;
  openAIBaseUrl(baseUrl: string): string;
  prepareChatRequest(config: { baseUrl: string; apiKey?: string; model: string }): Promise<object | undefined>;
  contextWindow(config: { baseUrl: string; apiKey?: string; model: string }): Promise<number | undefined>;
}
