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
  /**
   * Fired with `true` just before a model is loaded for the first time (the cold-start
   * /props + first inference) and `false` once it's ready. Lets the host show a loader
   * on the first message, not only on an explicit model switch.
   */
  onModelLoading?: (model: string, loading: boolean) => void;
  /**
   * Extra `chat_template_kwargs` sent with the MAIN model's chat requests (matched
   * by `model === config.model`, so routed/voice models are untouched). Forwarded
   * verbatim in the request body — e.g. `{ enable_thinking: false }` to turn off a
   * Qwen3 reasoning template.
   */
  chatTemplateKwargs?: Record<string, unknown>;
}
