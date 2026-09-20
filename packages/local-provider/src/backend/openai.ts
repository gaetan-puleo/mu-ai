import type { LocalBackendInfo, LocalModel } from '../types';
import { type Backend, type ModelModalities } from './types';

export const OPENAI_KIND = 'openai' as const;

/** Root URL without the `/v1` suffix (same convention as the llama-swap backend). */
export function normalizeOpenAIBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v\d+$/, '');
}

export function getOpenAIOpenAIBaseUrl(baseUrl: string): string {
  return `${normalizeOpenAIBaseUrl(baseUrl)}/v1`;
}

export async function listOpenAIModels(config: { baseUrl: string; apiKey?: string }): Promise<LocalModel[]> {
  const endpoint = `${getOpenAIOpenAIBaseUrl(config.baseUrl)}/models`;
  const response = await fetch(endpoint, {
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Failed to list OpenAI-compatible models: ${response.status} ${await response.text()}`);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`Failed to parse JSON from ${endpoint}: ${(err as Error).message}`);
  }
  const items = (data as { data?: unknown })?.data;
  if (!Array.isArray(items)) {
    throw new Error(`Malformed response from ${endpoint}: expected array at "data"`);
  }
  return items.map((model: { id: string; name?: string; description?: string; owned_by?: string }) => ({
    id: model.id,
    name: model.name,
    description: model.description,
    ownedBy: model.owned_by,
  }));
}

export async function openAIContextWindow(config: {
  baseUrl: string;
  apiKey?: string;
}): Promise<number | undefined> {
  try {
    const response = await fetch(`${normalizeOpenAIBaseUrl(config.baseUrl)}/health`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { context?: unknown };
    return typeof body.context === 'number' ? body.context : undefined;
  } catch {
    return undefined;
  }
}

export async function detectOpenAI(
  config: { baseUrl: string; apiKey?: string },
): Promise<LocalBackendInfo | undefined> {
  try {
    const models = await listOpenAIModels(config);
    if (models.length === 0) return undefined;
    return {
      kind: OPENAI_KIND,
      baseUrl: normalizeOpenAIBaseUrl(config.baseUrl),
      models,
    };
  } catch {
    return undefined;
  }
}

export const openai: Backend = {
  kind: OPENAI_KIND,
  detect: detectOpenAI,
  openAIBaseUrl: getOpenAIOpenAIBaseUrl,
  prepareChatRequest: async () => undefined,
  contextWindow: (config) => openAIContextWindow(config),
  modalities: async (): Promise<ModelModalities | undefined> => undefined,
  tokenize: async () => undefined,
};
