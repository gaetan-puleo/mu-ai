/**
 * Startup update check — fires off `npm view` probes in the background after
 * the TUI is up, then surfaces a toast through `uiService.notify` when mu or
 * any installed npm plugin has a newer version on the registry.
 *
 * Design constraints:
 *  - Must never block startup. Caller fire-and-forgets the returned promise.
 *  - Must never crash the host on network / DNS errors. Every probe is wrapped.
 *  - Must not hammer npm on every boot. Results are cached in
 *    `<cacheDir>/update-check.json` for `CACHE_TTL_MS` (24h).
 *  - Disable with `MU_NO_UPDATE_CHECK=1` (kill switch for offline / CI / tests).
 *
 * Toasts are routed through the existing `InkUIService.notify` queue, which
 * buffers messages emitted before any toast listener attaches — so even if
 * the probe finishes before the TUI mounts (rare; see fast `npm view` runs)
 * the alert still surfaces.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCacheDir, getDataDir } from '../config/index';
import type { InkUIService } from '../tui/plugins/InkUIService';
import {
  listConfiguredNpmPlugins,
  type NpmRegistryView,
  PACKAGE_NAME,
  probePluginAsync,
  probeSelfAsync,
} from './updateCheck';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const CACHE_FILENAME = 'update-check.json';

interface CacheShape {
  ts: number;
  results: Record<string, NpmRegistryView | null>;
}

function cachePath(): string {
  return join(getCacheDir(), CACHE_FILENAME);
}

function readCache(): CacheShape | null {
  try {
    const raw = readFileSync(cachePath(), 'utf-8');
    const parsed = JSON.parse(raw) as CacheShape;
    if (typeof parsed?.ts !== 'number' || typeof parsed?.results !== 'object') return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cache: CacheShape): void {
  try {
    mkdirSync(getCacheDir(), { recursive: true });
    writeFileSync(cachePath(), JSON.stringify(cache), 'utf-8');
  } catch {
    // Cache writes are best-effort; ignore disk errors.
  }
}

function isDisabled(): boolean {
  const v = process.env.MU_NO_UPDATE_CHECK;
  return v === '1' || v === 'true' || v === 'yes';
}

interface ProbeOutcome {
  self: NpmRegistryView | null;
  plugins: Map<string, NpmRegistryView | null>;
}

async function runProbes(): Promise<ProbeOutcome> {
  const dataDir = getDataDir();
  const pluginNames = listConfiguredNpmPlugins();

  const [self, ...plugins] = await Promise.all([
    probeSelfAsync().catch(() => null),
    ...pluginNames.map((name) => probePluginAsync(name, dataDir).catch(() => null)),
  ]);

  const pluginMap = new Map<string, NpmRegistryView | null>();
  pluginNames.forEach((name, i) => {
    pluginMap.set(name, plugins[i] ?? null);
  });

  return { self, plugins: pluginMap };
}

function outcomeFromCache(cache: CacheShape, pluginNames: string[]): ProbeOutcome {
  const self = cache.results[PACKAGE_NAME] ?? null;
  const plugins = new Map<string, NpmRegistryView | null>();
  for (const name of pluginNames) {
    plugins.set(name, cache.results[name] ?? null);
  }
  return { self, plugins };
}

function outcomeToCache(outcome: ProbeOutcome): CacheShape {
  const results: Record<string, NpmRegistryView | null> = {};
  results[PACKAGE_NAME] = outcome.self;
  for (const [name, view] of outcome.plugins) {
    results[name] = view;
  }
  return { ts: Date.now(), results };
}

function notifyOutcome(outcome: ProbeOutcome, ui: InkUIService): void {
  const stale: string[] = [];
  if (outcome.self?.hasUpdate) {
    stale.push(`mu ${outcome.self.current} → ${outcome.self.latest}`);
  }
  for (const [name, view] of outcome.plugins) {
    if (view?.hasUpdate) {
      stale.push(`${name} ${view.current} → ${view.latest}`);
    }
  }
  if (stale.length === 0) return;

  const header = stale.length === 1 ? 'Update available' : `${stale.length} updates available`;
  const body = stale.join(', ');
  ui.notify(`${header}: ${body}. Run \`mu update\` to apply.`, 'info');
}

/**
 * Background entry point. Resolves once the probe (or cache lookup) has
 * completed and any toast has been emitted. Callers should fire-and-forget.
 */
export async function checkForUpdatesInBackground(ui: InkUIService): Promise<void> {
  if (isDisabled()) return;

  const pluginNames = listConfiguredNpmPlugins();

  const cached = readCache();
  if (cached) {
    notifyOutcome(outcomeFromCache(cached, pluginNames), ui);
    return;
  }

  let outcome: ProbeOutcome;
  try {
    outcome = await runProbes();
  } catch {
    return;
  }

  writeCache(outcomeToCache(outcome));
  notifyOutcome(outcome, ui);
}
