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

/** Normalize a YAML value that may be a string[] or a comma-separated string into a trimmed string[]. */
export const strList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
  }
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
  return [];
};
