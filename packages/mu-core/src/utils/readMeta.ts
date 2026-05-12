/**
 * Typed accessors for `ChatMessageMeta`.
 *
 * Keep ergonomics that ad-hoc destructuring loses (default values,
 * narrowing). Strictly typed: keys are constrained to the declared
 * `ChatMessageMeta` shape so typos fail compile.
 */

import type { ChatMessageMeta } from '../messageMeta';

export function readMetaString<K extends keyof ChatMessageMeta>(
  meta: ChatMessageMeta | undefined,
  key: K,
): string | undefined {
  if (!meta) return undefined;
  const v = meta[key];
  return typeof v === 'string' ? v : undefined;
}

export function readMetaNumber<K extends keyof ChatMessageMeta>(
  meta: ChatMessageMeta | undefined,
  key: K,
  fallback?: number,
): number | undefined {
  if (!meta) return fallback;
  const v = meta[key];
  if (typeof v === 'number') return v;
  return fallback;
}
