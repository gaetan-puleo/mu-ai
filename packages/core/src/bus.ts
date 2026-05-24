export type Unsubscribe = () => void;

export interface EventBus<Event> {
  publish: (event: Event) => void;
  subscribe: (listener: (event: Event) => void) => Unsubscribe;
}

export function createBus<Event>(): EventBus<Event> {
  const listeners = new Set<(event: Event) => void>();

  return {
    publish(event) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          // Isolate listener errors so one bad handler cannot block delivery to others
        }
      }
    },

    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
