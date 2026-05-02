import type { InputInfoSegment } from 'mu-core';
import { useEffect, useState } from 'react';
import { useChatContext } from '../chat/ChatContext';

/**
 * Subscribe to the aggregated input-info segments published by plugins via
 * `PluginContext.setInputInfo`. Returns the live snapshot; re-renders on
 * every push from any plugin.
 */
export function useInputInfoSegments(): InputInfoSegment[] {
  const { registry } = useChatContext();
  const [segments, setSegments] = useState<InputInfoSegment[]>(() => registry.getInputInfoSegments());

  useEffect(() => {
    const unsub = registry.onInputInfoChange(() => {
      setSegments(registry.getInputInfoSegments());
    });
    return unsub;
  }, [registry]);

  return segments;
}
