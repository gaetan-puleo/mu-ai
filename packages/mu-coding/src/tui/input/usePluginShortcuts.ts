import type { PluginRegistry, ShortcutHandler } from 'mu-agents';
import { useEffect, useState } from 'react';

interface PluginShortcuts {
  /** Map of `keyId` (e.g. "tab", "ctrl+t") to plugin handler. */
  handlers: Map<string, ShortcutHandler>;
}

/**
 * Subscribe to the registry's shortcut bindings and expose a stable map keyed
 * by keyId. Multiple registrations on the same key are last-write-wins; the
 * agent plugin is expected to grab Tab and unregister cleanly on deactivation.
 */
export function usePluginShortcuts(registry: PluginRegistry): PluginShortcuts {
  const [handlers, setHandlers] = useState<Map<string, ShortcutHandler>>(() => buildMap(registry));
  useEffect(() => {
    setHandlers(buildMap(registry));
    return registry.onShortcutsChange(() => setHandlers(buildMap(registry)));
  }, [registry]);
  return { handlers };
}

function buildMap(registry: PluginRegistry): Map<string, ShortcutHandler> {
  const out = new Map<string, ShortcutHandler>();
  for (const entry of registry.getShortcuts()) {
    out.set(entry.key.toLowerCase(), entry.handler);
  }
  return out;
}
