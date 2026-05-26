import type { LLMResponseContext } from 'mu-core';

export type LocalBackendKind = 'llama-swap';

export interface LLMResponseContextSlot {
  id: number;
  n_ctx: number;
  is_processing: boolean;
}

export interface LLMResponseContextProps {
  n_ctx: number;
  total_slots: number;
  model_path: string;
  model_alias: string;
}

export interface LocalLLMResponseContext extends LLMResponseContext {
  props?: LLMResponseContextProps;
  slots?: LLMResponseContextSlot[];
  currentSlot?: LLMResponseContextSlot;
}

export interface LocalModel {
  id: string;
  name?: string;
  description?: string;
  ownedBy?: string;
}

export interface LocalBackendIdentity {
  kind: LocalBackendKind;
  baseUrl: string;
}

export interface LocalBackendInfo extends LocalBackendIdentity {
  models: LocalModel[];
}

export interface LocalProviderConfig {
  kind?: LocalBackendKind;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}
