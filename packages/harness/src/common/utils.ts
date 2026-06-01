export interface Emitter<T> {
  emit(event: T): void;
  subscribe(listener: (event: T) => void): () => void;
}

export const createEmitter = <T>(): Emitter<T> => {
  const listeners = new Set<(event: T) => void>();
  return {
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
