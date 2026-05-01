import type { PluginRegistry, StatusSegment } from 'mu-agents';
import { useEffect, useMemo, useState } from 'react';
import type { InkUIService } from '../plugins/InkUIService';

/**
 * Aggregate plugin status from the two complementary channels into one
 * flat segment list:
 *
 *  1. `registry.onStatusChange` — push-based, structured `StatusSegment[]` per
 *     plugin (color/dim metadata). Producers use `PluginContext.setStatusLine`.
 *  2. `uiService.onStatusChange` — free-form `key → text` map. Producers use
 *     `UIService.setStatus` (e.g. `mu-repomap` progress, Pi `pi.ui.setStatus`,
 *     Pi `pi.ui.setWidget`). Rendered as dim text since the API carries no
 *     color metadata.
 *
 * The split lets producers pick the right granularity; callers see a single
 * pre-merged list ready for the status bar.
 */
export function usePluginStatus(registry: PluginRegistry, uiService?: InkUIService): StatusSegment[] {
  const [pluginStatus, setPluginStatus] = useState<StatusSegment[]>([]);
  const [uiStatus, setUiStatus] = useState<StatusSegment[]>([]);

  useEffect(() => {
    setPluginStatus(registry.getStatusSegments());
    return registry.onStatusChange(() => {
      setPluginStatus(registry.getStatusSegments());
    });
  }, [registry]);

  useEffect(() => {
    if (!uiService) return;
    const apply = (entries: Map<string, string>) => {
      const segments: StatusSegment[] = [];
      for (const [, text] of entries) {
        segments.push({ text, dim: true });
      }
      setUiStatus(segments);
    };
    apply(uiService.getStatusEntries());
    return uiService.onStatusChange(apply);
  }, [uiService]);

  return useMemo(() => [...pluginStatus, ...uiStatus], [pluginStatus, uiStatus]);
}
