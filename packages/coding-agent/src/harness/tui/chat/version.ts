import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Read the nearest package's `version` by walking up from `startDir`. Works both
 * when run from source (tsx) and from the built dist, since the package.json sits
 * at the package root above the module.
 */
const readPkgVersion = (startDir: string): string => {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as { name?: string; version?: string };
      if (pkg.name && pkg.version) return pkg.version;
    } catch {
      // not here — keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
};

export const MU_VERSION = readPkgVersion(dirname(fileURLToPath(import.meta.url)));
