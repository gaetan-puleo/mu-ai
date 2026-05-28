/**
 * Resolve which plugin supplies the LLM provider.
 *
 *   1. If the host config names a `requestedName`, find the plugin by name —
 *      error if it isn't loaded or doesn't export a `provider`.
 *   2. Otherwise, if any loaded plugin already exposes a provider, use it
 *      (no fallback needed).
 *   3. Otherwise, prepend `fallback` to the plugin list and use it.
 *
 * Mutates `plugins` in place by prepending the fallback so the rest of the
 * bootstrap pipeline sees a single, ordered plugin array — callers don't
 * have to remember to add it back.
 */
import type { Plugin } from 'mu-core';

export interface PickProviderOptions {
  /** Already-loaded plugins (user + extras). The picker may unshift `fallback` into this array. */
  plugins: Plugin[];
  /** Name from host config (e.g. `config.provider`). Optional — when absent, fallback rules apply. */
  requestedName?: string;
  /** Built-in provider used when no plugin supplies one. */
  fallback: Plugin;
}

export interface PickedProvider {
  /** True when the fallback was selected (callers may wire local-only behavior on this). */
  usingFallback: boolean;
  /** The chosen provider plugin. */
  plugin: Plugin;
}

export function pickProviderPlugin(opts: PickProviderOptions): PickedProvider {
  const { plugins, requestedName, fallback } = opts;

  if (requestedName) {
    const named = plugins.find((p) => p.name === requestedName);
    if (!named?.provider) {
      const loaded = plugins.map((p) => p.name).join(', ') || '(none)';
      throw new Error(
        `Provider plugin "${requestedName}" not found or does not export a provider. Loaded plugins: ${loaded}`,
      );
    }
    return { usingFallback: false, plugin: named };
  }

  const fromUser = plugins.find((p) => p.provider);
  if (fromUser) {
    return { usingFallback: false, plugin: fromUser };
  }

  plugins.unshift(fallback);
  return { usingFallback: true, plugin: fallback };
}
