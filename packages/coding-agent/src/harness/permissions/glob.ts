import { matchesGlob } from 'node:path';

export const matchesAnyGlob = (value: string, patterns: string[]): boolean =>
  patterns.some((pattern) => matchesGlob(value, pattern));
