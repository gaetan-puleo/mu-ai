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
        listener(event);
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
