import type { ModelModalities } from 'mu-core';
import type { ModelRegistry } from './models';

export interface ModelLoadingHooks {
  /** Fired with loading=true before the probe and loading=false after it settles. */
  onLoading?(ref: string, loading: boolean): void;
  /** Fired with the probed modalities when the provider reports them. */
  onCapabilities?(caps: ModelModalities): void;
}

/**
 * Probe a model's input modalities, surfacing the cold-start as a loading state.
 *
 * Detecting modalities loads the model (a `/props` round-trip can be a 10-30s cold
 * start), so we bracket it with onLoading(true/false). This is the single source of
 * truth shared by every host — the in-process TUI adapter and the WebSocket server —
 * so model selection behaves identically regardless of transport. Callers own the
 * `models.select()` call itself, since the surrounding side effects (persist the
 * choice, broadcast a models:listed frame) and their ordering differ per host.
 */
export async function probeModelCapabilities(
  models: ModelRegistry,
  ref: string,
  hooks: ModelLoadingHooks = {},
): Promise<void> {
  hooks.onLoading?.(ref, true);
  try {
    const caps = await models.capabilities(ref).catch(() => undefined);
    if (caps) hooks.onCapabilities?.(caps);
  } finally {
    hooks.onLoading?.(ref, false);
  }
}
