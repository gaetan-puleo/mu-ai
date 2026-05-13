import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { getDataDir } from '../config';

const TTL_MS = 60 * 60 * 1000; // 1h

function getCacheDir(): string {
  return process.env.XDG_CACHE_HOME ? join(process.env.XDG_CACHE_HOME, 'mu') : join(homedir(), '.cache', 'mu');
}

function getCachePath(): string {
  return join(getCacheDir(), 'update-check.json');
}

interface CacheShape {
  ts: number;
  outdated: string[];
}

function readCache(): CacheShape | null {
  try {
    const raw = readFileSync(getCachePath(), 'utf-8');
    const parsed = JSON.parse(raw) as CacheShape;
    if (!parsed.ts || Date.now() - parsed.ts > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(outdated: string[]): void {
  try {
    const path = getCachePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ ts: Date.now(), outdated }), 'utf-8');
  } catch {
    /* cache failures are silent */
  }
}

async function probeOutdated(): Promise<string[]> {
  const root = getDataDir();
  if (!existsSync(join(root, 'package.json'))) return [];
  return await new Promise<string[]>((resolve) => {
    const proc = spawn('npm', ['outdated', '--json', '--prefix', root], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    proc.stdout.on('data', (b: Buffer) => {
      stdout += b.toString('utf-8');
    });
    proc.on('exit', () => {
      try {
        const parsed = JSON.parse(stdout || '{}') as Record<string, unknown>;
        resolve(Object.keys(parsed));
      } catch {
        resolve([]);
      }
    });
    proc.on('error', () => resolve([]));
  });
}

/**
 * Returns the list of outdated package names, using a 1h cache. Designed to
 * be called at TUI startup; failures return [].
 */
export async function startupUpdateCheck(): Promise<string[]> {
  const cached = readCache();
  if (cached) return cached.outdated;
  const fresh = await probeOutdated();
  writeCache(fresh);
  return fresh;
}
