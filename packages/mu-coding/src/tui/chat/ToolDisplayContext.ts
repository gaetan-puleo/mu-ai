import type { PluginRegistry, ToolDisplayHint } from 'mu-agents';
import { createContext, useContext, useMemo } from 'react';

type ToolDisplayMap = Map<string, ToolDisplayHint>;

const ToolDisplayContext = createContext<ToolDisplayMap>(new Map());

export const ToolDisplayProvider = ToolDisplayContext.Provider;

/** Hook used by tool renderers to look up rendering hints for a tool name. */
export function useToolDisplay(name: string): ToolDisplayHint | undefined {
  const map = useContext(ToolDisplayContext);
  return map.get(name);
}

/**
 * Build a lookup table from the registry, keyed by tool function name. Tools
 * without a `display` hint are omitted; the renderer falls back to a generic
 * preview block. Memoized on the registry reference — registration is
 * effectively startup-only today, but the dependency makes the contract
 * explicit if hot-loading lands later.
 */
export function useToolDisplayMap(registry: PluginRegistry): ToolDisplayMap {
  return useMemo(() => {
    const map: ToolDisplayMap = new Map();
    for (const tool of registry.getTools()) {
      if (tool.display) {
        map.set(tool.definition.function.name, tool.display);
      }
    }
    return map;
  }, [registry]);
}
