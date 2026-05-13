import { useCallback, useRef } from 'react';

type Handler = () => void | Promise<void>;

export interface ShortcutRegistry {
  add(key: string, handler: Handler): () => void;
  resolve(key: string): Handler | undefined;
  list(): Array<{ key: string; handler: Handler }>;
}

/**
 * Plugin-contributed keyboard shortcuts (Ctrl-X bindings). Keys are stored
 * verbatim (e.g. 'x' for Ctrl-X, 'r' for Ctrl-R).
 */
export function useShortcuts(): ShortcutRegistry {
  const map = useRef<Map<string, Handler>>(new Map());

  const add = useCallback((key: string, handler: Handler): (() => void) => {
    const existing = map.current.get(key);
    map.current.set(key, handler);
    return () => {
      const cur = map.current.get(key);
      if (cur === handler) {
        if (existing) map.current.set(key, existing);
        else map.current.delete(key);
      }
    };
  }, []);

  const resolve = useCallback((key: string): Handler | undefined => map.current.get(key), []);

  const list = useCallback(() => Array.from(map.current.entries()).map(([key, handler]) => ({ key, handler })), []);

  return { add, resolve, list };
}
