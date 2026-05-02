/**
 * `mu update` — bring installed plugins (and optionally mu itself) to the
 * latest version published on the npm registry.
 *
 * Plugins live in `~/.local/share/mu/node_modules/<name>` and are listed in
 * `config.plugins` as `npm:<name>` specifiers. Updating them is a thin
 * wrapper around `bun update --latest <name>` against the data dir, which
 * already owns its own `package.json`.
 *
 * mu itself is updated by re-running its global installer. We probe the
 * binary path to detect which manager owns the install (bun, npm, pnpm) and
 * fall back to a generic `npm i -g` instructions message on unknown setups.
 */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import {
  listConfiguredNpmPlugins,
  type NpmRegistryView,
  PACKAGE_NAME,
  probePluginSync,
  probeSelfSync,
} from '../runtime/updateCheck';
import { ensureDataDir } from './install';

function printRow(name: string, view: NpmRegistryView | null) {
  if (!view) {
    console.log(`  ${name.padEnd(28)} ?       (npm view failed)`);
    return;
  }
  const arrow = view.hasUpdate ? '→' : '=';
  const tail = view.hasUpdate ? `${view.current} ${arrow} ${view.latest}` : `${view.current} (up to date)`;
  console.log(`  ${name.padEnd(28)} ${tail}`);
}

// ─── outdated ────────────────────────────────────────────────────────────────

export async function runOutdated(args: string[]): Promise<void> {
  const scope = args[0];
  const wantsPlugins = !scope || scope === 'plugins' || scope === 'all';
  const wantsSelf = !scope || scope === 'self' || scope === 'mu' || scope === 'all';

  const dataDir = ensureDataDir();
  let anyUpdate = false;

  if (wantsSelf) {
    console.log('mu:');
    const view = probeSelfSync();
    printRow(PACKAGE_NAME, view);
    if (view?.hasUpdate) anyUpdate = true;
  }

  if (wantsPlugins) {
    const names = listConfiguredNpmPlugins();
    console.log(`\nplugins (${names.length}):`);
    if (names.length === 0) {
      console.log('  (none configured)');
    } else {
      for (const name of names) {
        const view = probePluginSync(name, dataDir);
        printRow(name, view);
        if (view?.hasUpdate) anyUpdate = true;
      }
    }
  }

  if (!anyUpdate) {
    console.log('\nEverything is up to date.');
  } else {
    console.log("\nRun 'mu update' to apply.");
  }
}

// ─── update plugins ──────────────────────────────────────────────────────────

function updatePlugin(name: string, dataDir: string): boolean {
  try {
    execFileSync('bun', ['update', '--latest', name], { cwd: dataDir, stdio: 'inherit' });
    return true;
  } catch (err) {
    console.error(`Failed to update ${name}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

export async function runUpdatePlugins(): Promise<{ ok: number; failed: number }> {
  const dataDir = ensureDataDir();
  const names = listConfiguredNpmPlugins();
  if (names.length === 0) {
    console.log('No npm plugins configured.');
    return { ok: 0, failed: 0 };
  }
  let ok = 0;
  let failed = 0;
  for (const name of names) {
    console.log(`\nUpdating ${name}…`);
    if (updatePlugin(name, dataDir)) {
      ok += 1;
      console.log(`✓ ${name}`);
    } else {
      failed += 1;
    }
  }
  return { ok, failed };
}

// ─── update self ─────────────────────────────────────────────────────────────

interface SelfInstallStrategy {
  manager: 'bun' | 'npm' | 'pnpm' | 'yarn' | 'unknown';
  command?: [string, string[]];
}

/**
 * Best-effort detection of which package manager installed `mu` globally.
 * We resolve the absolute binary path of the running process and look for
 * tell-tale path segments.
 */
function detectSelfInstall(): SelfInstallStrategy {
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

export async function runUpdateSelf(): Promise<boolean> {
  const view = probeSelfSync();
  if (view && !view.hasUpdate) {
    console.log(`mu is already up to date (${view.current}).`);
    return true;
  }

  const strategy = detectSelfInstall();
  if (!strategy.command) {
    console.log(
      [
        'Could not auto-detect how mu was installed.',
        'Re-install with one of:',
        `  bun add -g ${PACKAGE_NAME}@latest`,
        `  npm i -g ${PACKAGE_NAME}@latest`,
        `  pnpm add -g ${PACKAGE_NAME}@latest`,
      ].join('\n'),
    );
    return false;
  }

  const [bin, args] = strategy.command;
  console.log(`Updating mu via ${strategy.manager}…`);
  console.log(`$ ${bin} ${args.join(' ')}`);
  try {
    execFileSync(bin, args, { stdio: 'inherit' });
    console.log('✓ mu updated. Restart any running mu sessions.');
    return true;
  } catch (err) {
    console.error(`Failed to update mu: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

// ─── dispatcher ──────────────────────────────────────────────────────────────

export async function runUpdate(args: string[]): Promise<void> {
  const scope = args[0];

  if (scope === 'plugins') {
    const { failed } = await runUpdatePlugins();
    if (failed > 0) process.exit(1);
    return;
  }

  if (scope === 'self' || scope === 'mu') {
    const ok = await runUpdateSelf();
    if (!ok) process.exit(1);
    return;
  }

  if (scope && scope !== 'all') {
    console.error('Usage: mu update [plugins|self|all]');
    process.exit(1);
  }

  // Default: update everything.
  console.log('=== Updating plugins ===');
  const pluginRes = await runUpdatePlugins();
  console.log('\n=== Updating mu ===');
  const selfOk = await runUpdateSelf();
  if (pluginRes.failed > 0 || !selfOk) process.exit(1);
}
