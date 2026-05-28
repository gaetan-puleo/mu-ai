/**
 * Tiny ergonomic identity helpers — they don't change values, they just
 * carry the type signature so authors get IDE inference + name on hover.
 *
 * Use over hand-rolling literal objects: `defineTool({ … })` is half a step
 * cheaper than `const t: Tool<MyArgs> = { … }` and reads more like an SDK.
 */
import type { Plugin } from './plugin';
import type { LLMProvider } from './provider';
import type { Tool } from './types/Tool';

export function defineTool<TArgs = unknown, TResult = string>(
  tool: Tool<TArgs, TResult>,
): Tool<TArgs, TResult> {
  return tool;
}

/**
 * Preserve the literal key names of a tool map — `keyof typeof tools` stays
 * the names you typed instead of widening to `string`. Useful when a plugin
 * wants to expose its tool names to downstream consumers.
 */
export function defineTools<T extends Record<string, Tool>>(tools: T): T {
  return tools;
}

export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}

/**
 * Factory shape returned by `defineProvider`. Hosts call this with their
 * provider config (model, baseUrl, …) to get the `LLMProvider` they pass
 * into a `Plugin`.
 */
export type ProviderFactory<TConfig> = (config: TConfig) => LLMProvider;

export function defineProvider<TConfig>(
  factory: ProviderFactory<TConfig>,
): ProviderFactory<TConfig> {
  return factory;
}
