import type { LocalBackendInfo } from '../types';
import { llamaCpp } from './llama-cpp';
import { llamaSwap } from './llama-swap';
import type { Backend } from './types';

export * from './llama-swap';
export * from './llama-cpp';
export type { Backend } from './types';

export const backends: Backend[] = [llamaSwap, llamaCpp];

export const detectBackend = async (
  config: { baseUrl: string; apiKey?: string },
): Promise<{ backend: Backend; info: LocalBackendInfo } | undefined> => {
  for (const backend of backends) {
    const info = await backend.detect(config);
    if (info) return { backend, info };
  }
  return undefined;
};
