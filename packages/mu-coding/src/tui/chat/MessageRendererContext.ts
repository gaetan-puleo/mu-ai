import type { ChatMessage, PluginRegistry } from 'mu-core';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

/**
 * Plugin renderers are typed `unknown` in mu-agents (kept renderer-agnostic);
 * the host narrows to React at the boundary so renderer authors can return
 * any `ReactNode`.
 */
type ReactMessageRenderer = (msg: ChatMessage) => ReactNode;

type RendererMap = Map<string, ReactMessageRenderer>;

const MessageRendererContext = createContext<RendererMap>(new Map());

export const MessageRendererProvider = MessageRendererContext.Provider;

/** Hook used by `MessageItem` to look up custom renderers by `customType`. */
export function useMessageRenderer(customType: string | undefined): ReactMessageRenderer | undefined {
  const map = useContext(MessageRendererContext);
  if (!customType) return undefined;
  return map.get(customType);
}

/**
 * Track the registry's custom renderer set. Re-builds the map whenever a
 * plugin registers or unregisters one. The cast from `unknown` to ReactNode
 * happens here so descendant components stay strictly typed.
 */
export function useRegistryRenderers(registry: PluginRegistry): RendererMap {
  const [map, setMap] = useState<RendererMap>(() => buildMap(registry));
  useEffect(() => {
    setMap(buildMap(registry));
    return registry.onRenderersChange(() => setMap(buildMap(registry)));
  }, [registry]);
  return map;
}

function buildMap(registry: PluginRegistry): RendererMap {
  const out: RendererMap = new Map();
  for (const [customType, renderer] of registry.getRenderers()) {
    out.set(customType, (msg) => renderer(msg) as ReactNode);
  }
  return out;
}
