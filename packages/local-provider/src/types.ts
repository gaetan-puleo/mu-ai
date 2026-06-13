import type OpenAI from 'openai';
import type { ModelModalities } from './backend/types';

export class LocalProviderError extends Error {
  constructor(
    message: string,
    public readonly code: 'backend_unreachable' | 'backend_unsupported' | 'config_invalid',
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LocalProviderError';
  }
}

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

export interface LocalLLMResponseContext {
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

export interface LocalBackendInfo {
  kind: string;
  baseUrl: string;
  models: LocalModel[];
}

export interface LocalProviderConfig {
  kind?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  openAIClient?: typeof OpenAI;
  /**
   * Fired once per model the first time it is used (i.e. when the backend loads it and
   * its `/props` is read). Carries the detected context window + input modalities — lets
   * the host auto-set image/audio capabilities without a separate, model-loading probe.
   */
  onModelInfo?: (info: { model: string; contextWindow?: number; modalities?: ModelModalities }) => void;
}
