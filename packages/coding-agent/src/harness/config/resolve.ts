import { join } from 'node:path';
import type { HarnessConfig, HarnessConfigOptions } from './types';

export const createHarnessConfig = (options: HarnessConfigOptions): HarnessConfig => {
  const { hostName, xdg } = options;
  return {
    hostName,
    configDir: join(xdg.configHome, hostName),
    dataDir: join(xdg.dataHome, hostName),
    stateDir: join(xdg.stateHome, hostName),
  };
};
