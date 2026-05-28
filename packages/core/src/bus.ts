export type Unsubscribe = () => void;

export interface EventBus<Event> {
  publish: (event: Event) => void;
  subscribe: {
    (listener: (event: Event) => void): Unsubscribe;
    <T extends Event>(type: T extends { type: string } ? T['type'] : never, listener: (event: T) => void): Unsubscribe;
  };
}

export function createBus<Event>(): EventBus<Event> {
  const listeners = new Set<(event: Event) => void>();

  return {
    publish(event) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (err) {
          console.error('[mu-core] bus listener threw:', err);
        }
      }
    },

    subscribe(
      typeOrListener: string | ((event: Event) => void),
      maybeListener?: (event: Event) => void,
    ): Unsubscribe {
      if (typeof typeOrListener === 'function') {
        listeners.add(typeOrListener);
        return () => { listeners.delete(typeOrListener); };
      }

      const type = typeOrListener;
      const inner = maybeListener!;
      const filtered = (event: Event): void => {
        if (typeof event === 'object' && event !== null && 'type' in event && (event as { type: string }).type === type) {
          inner(event);
        }
      };
      listeners.add(filtered);
      return () => { listeners.delete(filtered); };
    },
  };
}
