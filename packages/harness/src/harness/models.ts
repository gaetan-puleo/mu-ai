import type { ModelModalities, Provider } from 'mu-core';

export interface ModelRegistryOptions {
  providers: Record<string, Provider>;
  default: string;
}

export interface ResolvedModel {
  provider: Provider;
  model: string;
}

export interface ModelRegistry {
  readonly selected: string;
  readonly providers: string[];
  select(ref: string): void;
  resolve(ref?: string): ResolvedModel;
  /** Probe a model's input modalities via its provider (may load the model). Undefined if unsupported. */
  capabilities(ref?: string): Promise<ModelModalities | undefined>;
}

export const createModelRegistry = (options: ModelRegistryOptions): ModelRegistry => {
  const { providers } = options;

  let selected = options.default;

  const resolve = (ref?: string): ResolvedModel => {
    const value = ref ?? selected;
    const slash = value.indexOf('/');
    if (slash <= 0 || slash === value.length - 1) {
      throw new Error(`ModelRegistry: model must be "provider/model", got "${value}"`);
    }
    const name = value.slice(0, slash);
    const provider = providers[name];
    if (!provider) throw new Error(`ModelRegistry: unknown provider "${name}"`);
    return { provider, model: value.slice(slash + 1) };
  };

  resolve(selected);

  return {
    get selected() {
      return selected;
    },
    get providers() {
      return Object.keys(providers);
    },
    select: (ref) => {
      resolve(ref);
      selected = ref;
    },
    resolve,
    capabilities: async (ref) => {
      const { provider, model } = resolve(ref);
      return provider.capabilities ? await provider.capabilities(model) : undefined;
    },
  };
};
