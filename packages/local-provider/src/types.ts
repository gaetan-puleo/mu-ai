import type { LLMResponseContext } from 'mu-core';
import type OpenAI from 'openai';

/**
 * Typed errors raised by the local provider so callers can distinguish
 * "backend unreachable" from "config missing" without string matching.
 */
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

export interface LocalBackendInfo {
  kind: 'llama-swap';
  baseUrl: string;
  models: LocalModel[];
}

export interface LocalProviderConfig {
  kind?: 'llama-swap';
  baseUrl?: string;
  /**
   * Model id to use for chat completions. Required at request time — the
   * runtime check at the top of each call enforces it, but declaring it
   * required here surfaces the contract at the boundary.
   */
  model: string;
  apiKey?: string;
  /**
   * Idle timeout in milliseconds. If no chunk arrives from the stream within this
   * window the request is aborted. Defaults to 30000. Set to 0 to disable.
   */
  streamTimeoutMs?: number;
  /**
   * Optional host-supplied abort signal source. Called for each request; the
   * returned signal is composed with the idle-timeout signal so either can
   * cancel the in-flight stream.
   */
  getAbortSignal?: () => AbortSignal | undefined;
  /**
   * Optional OpenAI client constructor. Defaults to the SDK's `OpenAI`. Provided
   * primarily for tests that need to substitute a mock client.
   */
  openAIClient?: typeof OpenAI;
}
