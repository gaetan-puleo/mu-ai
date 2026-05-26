import type {
  LocalBackendInfo,
  LocalLLMResponseContext,
  LocalModel,
} from './types';

export const LLAMA_SWAP_KIND = 'llama-swap' as const;

export function normalizeLlamaSwapBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

export function getLlamaSwapOpenAIBaseUrl(baseUrl: string): string {
  return `${normalizeLlamaSwapBaseUrl(baseUrl)}/v1`;
}

export async function listLlamaSwapModels(config: { baseUrl: string; apiKey?: string }): Promise<LocalModel[]> {
  const baseUrl = normalizeLlamaSwapBaseUrl(config.baseUrl);

  const response = await fetch(`${baseUrl}/v1/models`, {
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Failed to list llama-swap models: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();

  return data.data.map((model: { id: string; name?: string; description?: string; owned_by?: string }) => ({
    id: model.id,
    name: model.name,
    description: model.description,
    ownedBy: model.owned_by,
  }));
}

export interface LlamaSwapSlotInfo {
  id: number;
  n_ctx: number;
  speculative?: boolean;
  is_processing: boolean;
  id_task?: number;
  next_token?: Array<{
    has_next_token: boolean;
    has_new_line: boolean;
    n_remain: number;
    n_decoded: number;
  }>;
}

export interface LlamaSwapProps {
  default_generation_settings: {
    n_ctx: number;
  };
  total_slots: number;
  model_path: string;
  model_alias: string;
}

export async function getLlamaSwapProps(config: {
  baseUrl: string;
  apiKey?: string;
  model?: string;
}): Promise<LlamaSwapProps | undefined> {
  const baseUrl = normalizeLlamaSwapBaseUrl(config.baseUrl);
  const model = config.model ?? '';

  try {
    const response = await fetch(`${baseUrl}/upstream/${encodeURIComponent(model)}/props`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    });

    if (!response.ok) {
      return undefined;
    }

    return response.json();
  } catch {
    return undefined;
  }
}

export async function getLlamaSwapSlots(config: {
  baseUrl: string;
  apiKey?: string;
  model?: string;
}): Promise<LlamaSwapSlotInfo[] | undefined> {
  const baseUrl = normalizeLlamaSwapBaseUrl(config.baseUrl);
  const model = config.model ?? '';

  try {
    const response = await fetch(`${baseUrl}/upstream/${encodeURIComponent(model)}/slots`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    });

    if (!response.ok) {
      return undefined;
    }

    return response.json();
  } catch {
    return undefined;
  }
}

export interface LlamaSwapChatRequestExtras {
  id_slot: number;
  cache_prompt: boolean;
}

export async function prepareLlamaSwapChatRequest(config: {
  baseUrl: string;
  apiKey?: string;
  model: string;
}): Promise<LlamaSwapChatRequestExtras | undefined> {
  const slots = await getLlamaSwapSlots(config);
  if (!slots?.length) {
    return undefined;
  }
  const slot = slots.find((s) => !s.is_processing);
  if (!slot) {
    return undefined;
  }
  return {
    id_slot: slot.id,
    cache_prompt: true,
  };
}

export async function collectLlamaSwapContext(config: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  selectedSlotId?: number;
}): Promise<LocalLLMResponseContext | undefined> {
  const [slots, props] = await Promise.all([
    getLlamaSwapSlots(config).catch(() => undefined),
    getLlamaSwapProps(config).catch(() => undefined),
  ]);

  if (!(slots || props)) {
    return undefined;
  }

  const context: LocalLLMResponseContext = {};

  if (props) {
    context.props = {
      n_ctx: props.default_generation_settings.n_ctx,
      total_slots: props.total_slots,
      model_path: props.model_path,
      model_alias: props.model_alias,
    };
  }

  if (slots?.length) {
    const normalizedSlots = slots.map((slot) => ({
      id: slot.id,
      n_ctx: slot.n_ctx,
      is_processing: slot.is_processing,
    }));
    context.slots = normalizedSlots;

    if (config.selectedSlotId !== undefined) {
      const current = normalizedSlots.find((s) => s.id === config.selectedSlotId);
      if (current) {
        context.currentSlot = current;
      }
    }
  }

  return context;
}

export async function tokenizeLlamaSwap(config: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  content: string;
}): Promise<number | undefined> {
  if (!config.content) return 0;
  const baseUrl = normalizeLlamaSwapBaseUrl(config.baseUrl);

  try {
    const response = await fetch(`${baseUrl}/upstream/${encodeURIComponent(config.model)}/tokenize`, {
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

export async function detectLlamaSwap(config: {
  baseUrl: string;
  apiKey?: string;
}): Promise<LocalBackendInfo | undefined> {
  const baseUrl = normalizeLlamaSwapBaseUrl(config.baseUrl);

  try {
    const models = await listLlamaSwapModels({ baseUrl, apiKey: config.apiKey });

    if (!models.some((model) => model.ownedBy === 'llama-swap')) {
      return undefined;
    }

    return {
      kind: LLAMA_SWAP_KIND,
      baseUrl,
      models,
    };
  } catch {
    return undefined;
  }
}
