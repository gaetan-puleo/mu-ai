import type { Tools } from './types/Tool';

export interface PluginHooks {
  onStart?: () => void | Promise<void>;
  onStop?: () => void | Promise<void>;
  onError?: (error: unknown) => void;
}

export interface Plugin {
  name: string;
  tools?: Tools;
  hooks?: PluginHooks;
}

export function definePlugin<Args extends unknown[]>(factory: (...args: Args) => Plugin): (...args: Args) => Plugin {
  return factory;
}
