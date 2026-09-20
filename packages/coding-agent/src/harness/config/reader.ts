// Tiny typed reader for JSON config objects. Collapses the `typeof obj.x === 'string'`
// wall into named accessors with consistent empty/undefined semantics, so a missed
// type check can't silently leak a wrong-typed value. Shared by mu and arya.

/** A trimmed, non-empty env var, or undefined. */
export const envStr = (name: string): string | undefined => {
  const v = process.env[name];
  return v && v.trim() ? v : undefined;
};

export interface ConfigReader {
  /** Non-empty trimmed string, else undefined. */
  str(key: string): string | undefined;
  /** Non-empty trimmed string, else `fallback` (always a string). */
  str(key: string, fallback: string): string;
  /** Boolean value, else undefined. */
  bool(key: string): boolean | undefined;
  /** Boolean value, else `fallback` (always a boolean). */
  bool(key: string, fallback: boolean): boolean;
  /** Finite number, else undefined. */
  num(key: string): number | undefined;
  /** Finite number, else `fallback` (always a number). */
  num(key: string, fallback: number): number;
  /** Nested object, or `{}` when absent/not-an-object. */
  obj(key: string): Record<string, unknown>;
  /** Array, or undefined. */
  arr(key: string): unknown[] | undefined;
  /** Raw value. */
  raw(key: string): unknown;
}

export const readConfig = (source: Record<string, unknown> | undefined): ConfigReader => {
  const obj = source ?? {};
  return {
    str: ((key: string, fallback?: string) => {
      const v = obj[key];
      return typeof v === 'string' && v.trim() ? v : fallback;
    }) as ConfigReader['str'],
    bool: ((key: string, fallback?: boolean) => {
      const v = obj[key];
      return typeof v === 'boolean' ? v : fallback;
    }) as ConfigReader['bool'],
    num: ((key: string, fallback?: number) => {
      const v = obj[key];
      return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    }) as ConfigReader['num'],
    obj: (key) => {
      const v = obj[key];
      return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
    },
    arr: (key) => (Array.isArray(obj[key]) ? (obj[key] as unknown[]) : undefined),
    raw: (key) => obj[key],
  };
};
