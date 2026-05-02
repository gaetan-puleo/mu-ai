/**
 * TUI-friendly update runner — same semantics as `mu update` from the CLI,
 * but never writes to stdout/stderr (Ink owns the terminal). Progress and
 * results are surfaced as toasts via `uiService.notify`.
 *
 * Mirrors `cli/update.ts` but uses `child_process.execFile` with `stdio:
 * 'pipe'` so subprocess output is buffered, not streamed to the TUI's tty.
 */

import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { promisify } from 'node:util';
import { ensureDataDir } from '../../cli/install';
import { invalidateUpdateCheckCache } from '../../runtime/startupUpdateCheck';
import { listConfiguredNpmPlugins, PACKAGE_NAME } from '../../runtime/updateCheck';
import type { InkUIService } from '../plugins/InkUIService';

const execFileAsync = promisify(execFile);

export type UpdateScope = 'all' | 'plugins' | 'self';

interface SelfInstallStrategy {
  manager: 'bun' | 'npm' | 'pnpm' | 'yarn' | 'unknown';
  command?: [string, string[]];
}

function detectSelfInstall(): SelfInstallStrategy {
  let bin = process.argv[1] ?? '';
  try {
    bin = realpathSync(bin);
  } catch {
    // keep raw argv
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

async function updatePlugin(name: string, dataDir: string): Promise<boolean> {
  try {
    await execFileAsync('bun', ['update', '--latest', name], { cwd: dataDir });
    return true;
  } catch {
    return false;
  }
}

async function updatePlugins(ui: InkUIService): Promise<{ ok: number; failed: number; total: number }> {
  const dataDir = ensureDataDir();
  const names = listConfiguredNpmPlugins();
  if (names.length === 0) return { ok: 0, failed: 0, total: 0 };

  let ok = 0;
  let failed = 0;
  for (const name of names) {
    ui.notify(`Updating ${name}…`, 'info');
    if (await updatePlugin(name, dataDir)) ok += 1;
    else {
      failed += 1;
      ui.notify(`Failed to update ${name}`, 'error');
    }
  }
  return { ok, failed, total: names.length };
}

async function updateSelf(ui: InkUIService): Promise<boolean> {
  const strategy = detectSelfInstall();
  if (!strategy.command) {
    ui.notify(`Cannot auto-detect mu's installer. Re-install manually: bun add -g ${PACKAGE_NAME}@latest`, 'warning');
    return false;
  }
  const [bin, args] = strategy.command;
  ui.notify(`Updating mu via ${strategy.manager}…`, 'info');
  try {
    await execFileAsync(bin, args);
    ui.notify('mu updated. Restart your session to pick up the new version.', 'success');
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n')[0] : String(err);
    ui.notify(`Failed to update mu: ${message}`, 'error');
    return false;
  }
}

/**
 * Entry point used by the `/update` slash command. Fire-and-forget — the
 * caller voids the returned promise. All progress / errors land in toasts.
 */
export async function runUpdateInTui(scope: UpdateScope, ui: InkUIService): Promise<void> {
  if (scope === 'plugins') {
    const { ok, failed, total } = await updatePlugins(ui);
    if (total === 0) ui.notify('No npm plugins configured.', 'info');
    else if (failed === 0) ui.notify(`Updated ${ok}/${total} plugin${total === 1 ? '' : 's'}.`, 'success');
    else ui.notify(`Plugins: ${ok} updated, ${failed} failed.`, 'warning');
    invalidateUpdateCheckCache();
    return;
  }

  if (scope === 'self') {
    await updateSelf(ui);
    invalidateUpdateCheckCache();
    return;
  }

  // 'all'
  const plugins = await updatePlugins(ui);
  const selfOk = await updateSelf(ui);
  if (plugins.total === 0 && selfOk) {
    // mu-only success already toasted; nothing to add
  } else if (plugins.failed === 0 && selfOk) {
    ui.notify('Update complete.', 'success');
  } else {
    ui.notify('Update finished with errors — see prior messages.', 'warning');
  }
  invalidateUpdateCheckCache();
}
