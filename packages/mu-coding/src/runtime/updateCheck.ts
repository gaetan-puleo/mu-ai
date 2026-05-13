/**
 * Shared "is there a newer version?" probes used by both the `mu update` /
 * `mu outdated` CLI subcommands (synchronous, blocking) and the in-TUI
 * startup alert (asynchronous, cached). Pure & side-effect free except for
 * the actual `npm view` exec — no toast / IO concerns live here.
 */

import { execFile, execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadConfig, parseBareNpmSpec } from '../config/index';

const execFileAsync = promisify(execFile);

export const PACKAGE_NAME = 'mu-coding';

export interface NpmRegistryView {
  current: string;
  latest: string;
  hasUpdate: boolean;
}

function npmViewLatestSync(name: string): string | undefined {
  try {
    const out = execFileSync('npm', ['view', name, 'version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    });
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function npmViewLatest(name: string, timeoutMs = 8000): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('npm', ['view', name, 'version'], {
      timeout: timeoutMs,
      encoding: 'utf-8',
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function readInstalledVersion(name: string, cwd: string): string | undefined {
  try {
    const path = join(cwd, 'node_modules', name, 'package.json');
    const pkg = JSON.parse(readFileSync(path, 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

function readSelfVersion(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', '..', 'package.json'),
    join(here, '..', 'package.json'),
    join(here, '..', '..', '..', 'package.json'),
  ];
  for (const path of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(path, 'utf-8'));
      if (pkg?.name === PACKAGE_NAME && typeof pkg.version === 'string') return pkg.version;
    } catch {
      // try next
    }
  }
  return undefined;
}

export function listConfiguredNpmPlugins(): string[] {
  const config = loadConfig();
  const out: string[] = [];
  for (const entry of config.plugins ?? []) {
    const spec = typeof entry === 'string' ? entry : entry.name;
    if (!spec.startsWith('npm:')) continue;
    const { name } = parseBareNpmSpec(spec.slice(4));
    out.push(name);
  }
  return out;
}

/**
 * Best-effort "is `latest` newer than `current`?". Splits on `.+-` and
 * compares numeric segments left-to-right. Returns `true` when `current` is
 * unknown so a missing local install reads as "needs install / update".
 */
function isVersionNewer(current: string | undefined, latest: string): boolean {
  if (!current) return true;
  if (current === latest) return false;
  const cur = current.split(/[.+-]/).map((p) => Number.parseInt(p, 10));
  const lat = latest.split(/[.+-]/).map((p) => Number.parseInt(p, 10));
  const len = Math.max(cur.length, lat.length);
  for (let i = 0; i < len; i++) {
    const a = cur[i];
    const b = lat[i];
    if (Number.isNaN(a ?? Number.NaN) || Number.isNaN(b ?? Number.NaN)) return current !== latest;
    if ((a ?? 0) < (b ?? 0)) return true;
    if ((a ?? 0) > (b ?? 0)) return false;
  }
  return false;
}

export function probePluginSync(name: string, dataDir: string): NpmRegistryView | null {
  const latest = npmViewLatestSync(name);
  if (!latest) return null;
  const current = readInstalledVersion(name, dataDir);
  return { current: current ?? '(not installed)', latest, hasUpdate: isVersionNewer(current, latest) };
}

export function probeSelfSync(): NpmRegistryView | null {
  const latest = npmViewLatestSync(PACKAGE_NAME);
  if (!latest) return null;
  const current = readSelfVersion();
  return { current: current ?? '(unknown)', latest, hasUpdate: isVersionNewer(current, latest) };
}

export async function probePluginAsync(name: string, dataDir: string): Promise<NpmRegistryView | null> {
  const latest = await npmViewLatest(name);
  if (!latest) return null;
  const current = readInstalledVersion(name, dataDir);
  return { current: current ?? '(not installed)', latest, hasUpdate: isVersionNewer(current, latest) };
}

export async function probeSelfAsync(): Promise<NpmRegistryView | null> {
  const latest = await npmViewLatest(PACKAGE_NAME);
  if (!latest) return null;
  const current = readSelfVersion();
  return { current: current ?? '(unknown)', latest, hasUpdate: isVersionNewer(current, latest) };
}

// ─── Self-install detection ──────────────────────────────────────────────────

export interface SelfInstallStrategy {
  manager: 'bun' | 'npm' | 'pnpm' | 'yarn' | 'unknown';
  command?: [string, string[]];
}

/**
 * Best-effort detection of which package manager installed `mu` globally.
 * We resolve the absolute binary path of the running process and look for
 * tell-tale path segments.
 */
export function detectSelfInstall(): SelfInstallStrategy {
  let bin = process.argv[1] ?? '';
  try {
    bin = realpathSync(bin);
  } catch {
    // keep raw argv path
  }
  const norm = bin.replace(/\\/g, '/');

  if (norm.includes('/.bun/') || norm.includes('/bun/install/')) {
    return { manager: 'bun', command: ['bun', ['add', '-g', `${PACKAGE_NAME}@latest`]] };
  }
  if (norm.includes('/pnpm/')) {
    return { manager: 'pnpm', command: ['pnpm', ['add', '-g', `${PACKAGE_NAME}@latest`]] };
  }
  if (norm.includes('/.yarn/') || norm.includes('/yarn/global/')) {
    return { manager: 'yarn', command: ['yarn', ['global', 'add', `${PACKAGE_NAME}@latest`]] };
  }
  if (norm.includes('/npm/') || norm.includes('node_modules/.bin/mu')) {
    return { manager: 'npm', command: ['npm', ['i', '-g', `${PACKAGE_NAME}@latest`]] };
  }
  return { manager: 'unknown' };
}

// ─── Plugin update ───────────────────────────────────────────────────────────

/**
 * Run `bun update --latest <name>` in the data dir. Returns `true` on success.
 */
export async function updatePluginPackage(name: string, dataDir: string): Promise<boolean> {
  try {
    await execFileAsync('bun', ['update', '--latest', name], { cwd: dataDir });
    return true;
  } catch {
    return false;
  }
}
