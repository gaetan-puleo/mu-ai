import { homedir } from 'node:os';
import { join } from 'node:path';
import type { XdgDirs } from './types';

// A whitespace-only env var is treated as unset (fall back to the XDG default).
const fromEnv = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value && value.trim() ? value : fallback;
};

/**
 * Resolve the XDG base dirs from the environment, with the spec defaults.
 * Single source of truth shared by every mu/arya consumer — do not re-implement.
 */
export const resolveXdg = (): XdgDirs => {
  const home = homedir();
  return {
    configHome: fromEnv('XDG_CONFIG_HOME', join(home, '.config')),
    dataHome: fromEnv('XDG_DATA_HOME', join(home, '.local', 'share')),
    stateHome: fromEnv('XDG_STATE_HOME', join(home, '.local', 'state')),
  };
};
