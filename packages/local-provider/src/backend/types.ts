import type { ModelModalities } from 'mu-core';
import type { LocalBackendInfo } from '../types';

export type { ModelModalities };

/** Narrow a raw `/props.modalities` object (`{vision,video,audio}`) to the modalities we care about. */
export const toModalities = (raw: unknown): ModelModalities | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  return { vision: o.vision === true, audio: o.audio === true };
};

export interface Backend {
  kind: string;
  detect(config: { baseUrl: string; apiKey?: string }): Promise<LocalBackendInfo | undefined>;
  openAIBaseUrl(baseUrl: string): string;
  prepareChatRequest(config: { baseUrl: string; apiKey?: string; model: string }): Promise<object | undefined>;
  contextWindow(config: { baseUrl: string; apiKey?: string; model: string }): Promise<number | undefined>;
  /** Modalities reported by `/props` (already fetched for contextWindow — no extra round-trip). */
  modalities(config: { baseUrl: string; apiKey?: string; model: string }): Promise<ModelModalities | undefined>;
  /** Exact token count of `content` via the model's own tokenizer (llama.cpp `/tokenize`). */
  tokenize(config: { baseUrl: string; apiKey?: string; model: string; content: string }): Promise<number | undefined>;
}
