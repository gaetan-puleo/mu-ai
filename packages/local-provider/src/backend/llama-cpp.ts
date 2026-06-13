import type { LocalBackendInfo, LocalModel } from '../types';
import { type Backend, type ModelModalities, toModalities } from './types';

export const LLAMA_CPP_KIND = 'llama-cpp' as const;

export function normalizeLlamaCppBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

export function getLlamaCppOpenAIBaseUrl(baseUrl: string): string {
  return `${normalizeLlamaCppBaseUrl(baseUrl)}/v1`;
}

export async function listLlamaCppModels(config: { baseUrl: string; apiKey?: string }): Promise<LocalModel[]> {
  const baseUrl = normalizeLlamaCppBaseUrl(config.baseUrl);
  const response = await fetch(`${baseUrl}/v1/models`, {
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
  });
  if (!response.ok) return [];
  const data = await response.json().catch(() => undefined);
  const items = (data as { data?: unknown })?.data;
  if (!Array.isArray(items)) return [];
  return items.map((model: { id: string; name?: string; description?: string; owned_by?: string }) => ({
    id: model.id,
    name: model.name,
    description: model.description,
    ownedBy: model.owned_by,
  }));
}

export interface LlamaCppProps {
  default_generation_settings?: { n_ctx?: number };
  total_slots?: number;
  model_path?: string;
  modalities?: { vision?: boolean; audio?: boolean; video?: boolean };
}

export async function getLlamaCppProps(
  config: { baseUrl: string; apiKey?: string },
): Promise<LlamaCppProps | undefined> {
  const baseUrl = normalizeLlamaCppBaseUrl(config.baseUrl);
  try {
    const response = await fetch(`${baseUrl}/props`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    });
    if (!response.ok) return undefined;
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
    return data as LlamaCppProps;
  } catch {
    return undefined;
  }
}

export interface LlamaCppSlotInfo {
  id: number;
  is_processing: boolean;
}

export async function getLlamaCppSlots(
  config: { baseUrl: string; apiKey?: string },
): Promise<LlamaCppSlotInfo[] | undefined> {
  const baseUrl = normalizeLlamaCppBaseUrl(config.baseUrl);
  try {
    const response = await fetch(`${baseUrl}/slots`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    });
    if (!response.ok) return undefined;
    const data = await response.json();
    if (!Array.isArray(data)) return undefined;
    return data as LlamaCppSlotInfo[];
  } catch {
    return undefined;
  }
}

export async function prepareLlamaCppChatRequest(config: {
  baseUrl: string;
  apiKey?: string;
}): Promise<{ id_slot?: number; cache_prompt: boolean }> {
  const slots = await getLlamaCppSlots(config);
  const free = slots?.find((slot) => !slot.is_processing);
  return free ? { id_slot: free.id, cache_prompt: true } : { cache_prompt: true };
}

export async function detectLlamaCpp(
  config: { baseUrl: string; apiKey?: string },
): Promise<LocalBackendInfo | undefined> {
  const baseUrl = normalizeLlamaCppBaseUrl(config.baseUrl);
  const props = await getLlamaCppProps({ baseUrl, apiKey: config.apiKey });
  if (!props) return undefined;
  const models = await listLlamaCppModels({ baseUrl, apiKey: config.apiKey }).catch(() => []);
  return {
    kind: LLAMA_CPP_KIND,
    baseUrl,
    models: models.length > 0 ? models : [{ id: props.model_path ?? 'local' }],
  };
}

export async function llamaCppContextWindow(config: {
  baseUrl: string;
  apiKey?: string;
}): Promise<number | undefined> {
  const props = await getLlamaCppProps(config);
  return props?.default_generation_settings?.n_ctx;
}

export async function llamaCppModalities(config: {
  baseUrl: string;
  apiKey?: string;
}): Promise<ModelModalities | undefined> {
  const props = await getLlamaCppProps(config);
  return toModalities(props?.modalities);
}

export async function tokenizeLlamaCpp(config: {
  baseUrl: string;
  apiKey?: string;
  content: string;
}): Promise<number | undefined> {
  if (!config.content) return 0;
  const baseUrl = normalizeLlamaCppBaseUrl(config.baseUrl);
  try {
    const response = await fetch(`${baseUrl}/tokenize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ content: config.content, add_special: false }),
    });
    if (!response.ok) return undefined;
    const data = await response.json();
    return Array.isArray(data?.tokens) ? data.tokens.length : undefined;
  } catch {
    return undefined;
  }
}

export const llamaCpp: Backend = {
  kind: LLAMA_CPP_KIND,
  detect: detectLlamaCpp,
  openAIBaseUrl: getLlamaCppOpenAIBaseUrl,
  prepareChatRequest: prepareLlamaCppChatRequest,
  contextWindow: llamaCppContextWindow,
  modalities: llamaCppModalities,
  tokenize: (c) => tokenizeLlamaCpp(c),
};
