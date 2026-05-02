import type { Provider } from './adapter';

export interface ProviderRegistry {
  register: (provider: Provider) => () => void;
  get: (id: string) => Provider | undefined;
  list: () => Provider[];
}

export function createProviderRegistry(): ProviderRegistry {
  const providers = new Map<string, Provider>();
  return {
    register(p) {
      if (providers.has(p.id)) throw new Error(`Provider already registered: ${p.id}`);
      providers.set(p.id, p);
      return () => {
        providers.delete(p.id);
      };
    },
    get(id) {
      return providers.get(id);
    },
    list() {
      return Array.from(providers.values());
    },
  };
}
