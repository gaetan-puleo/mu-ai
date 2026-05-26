/**
 * Minimal .env file loader. Reads `KEY=value` lines and pushes them onto
 * `process.env` (only when the key isn't already set). Returns a report so
 * the host can log what was loaded vs. skipped.
 */
import { readFileSync } from 'node:fs';

export interface LoadEnvResult {
  found: boolean;
  loaded: string[];
  skipped: string[];
}

export function loadEnvFile(path: string): LoadEnvResult {
  const result: LoadEnvResult = { found: false, loaded: [], skipped: [] };
  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
    result.found = true;
  } catch {
    return result;
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    if (process.env[key]) {
      result.skipped.push(key);
    } else {
      process.env[key] = value;
      result.loaded.push(key);
    }
  }
  return result;
}

/** Mask sensitive env values for logging (keeps first/last chars). */
export function maskEnvValue(value: string | undefined): string {
  if (!value) return '<empty>';
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${value.slice(0, 2)}${'*'.repeat(Math.min(value.length - 4, 8))}${value.slice(-2)} (len=${value.length})`;
}
