import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentSettings } from './types';

/**
 * Read settings from disk. Missing file or malformed JSON resolves to an
 * empty object — agents start fresh rather than crashing on first run.
 */
export function loadSettings(path: string): AgentSettings {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as AgentSettings;
  } catch {
    return {};
  }
}

/** Write settings, creating parent directories on demand. Errors are swallowed. */
export function saveSettings(path: string, settings: AgentSettings): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8');
  } catch {
    /* ignore — settings are best-effort */
  }
}
