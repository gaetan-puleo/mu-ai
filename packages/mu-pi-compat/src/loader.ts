import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PluginContext, UIService } from 'mu-agents';
import { getDataDir } from 'mu-coding/paths';
import { PiShim } from './shim';
import type { PiCompatConfig, PiExtensionFactory } from './types';

export type ShutdownFn = (code?: number) => Promise<void> | void;

/**
 * Load a single Pi extension from a file path or npm: specifier.
 * Bun handles TypeScript imports natively — no jiti needed.
 *
 * The XDG data directory (where `mu install npm:<pkg>` puts plugins) is shared
 * with mu-coding via the `mu-coding/paths` subpath so the two packages can
 * never disagree about resolution.
 */
function formatError(entry: string, err: unknown): string {
  const parts: string[] = [`Extension "${entry}" failed to load`];
  let current: unknown = err;
  while (current) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(': ');
}

/**
 * Resolve an npm: specifier to extension file paths by reading the package's
 * "pi" field from its package.json.
 */
function resolveNpmExtensionPaths(entry: string): string[] {
  const bare = entry.slice(4);
  const dataDir = getDataDir();
  const pkgDir = join(dataDir, 'node_modules', ...bare.split('/'));
  const pkgJsonPath = join(pkgDir, 'package.json');

  if (!existsSync(pkgJsonPath)) {
    throw new Error(`Package "${bare}" not found at ${pkgDir} — is it installed?`);
  }

  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  const piExtensions: string[] | undefined = pkg.pi?.extensions;

  if (!piExtensions?.length) {
    throw new Error(`Package "${bare}" has no "pi.extensions" field in package.json`);
  }

  const paths: string[] = [];
  for (const ext of piExtensions) {
    const resolved = resolve(pkgDir, ext);
    if (!existsSync(resolved)) {
      throw new Error(`Extension path "${ext}" from "${bare}" does not exist: ${resolved}`);
    }
    const stat = statSync(resolved);
    if (stat.isDirectory()) {
      const indexTs = join(resolved, 'index.ts');
      const indexJs = join(resolved, 'index.js');
      if (existsSync(indexTs)) {
        paths.push(indexTs);
      } else if (existsSync(indexJs)) {
        paths.push(indexJs);
      } else {
        throw new Error(`Extension directory "${ext}" from "${bare}" has no index.ts or index.js`);
      }
    } else {
      paths.push(resolved);
    }
  }
  return paths;
}

async function importModule(path: string, label: string): Promise<Record<string, unknown>> {
  try {
    return await import(path);
  } catch (err) {
    throw new Error(`Failed to import ${label} (${path})`, { cause: err });
  }
}

async function loadModuleAsExtension(
  mod: Record<string, unknown>,
  label: string,
  ctx: PluginContext,
  ui: UIService,
  shutdown?: ShutdownFn,
): Promise<PiShim> {
  const factory: PiExtensionFactory = (mod.default ?? mod) as PiExtensionFactory;

  if (typeof factory !== 'function') {
    const exportKeys = Object.keys(mod).join(', ') || '(none)';
    throw new Error(`"${label}" does not export a default function. Exports: [${exportKeys}]`);
  }

  const shim = new PiShim(ctx, ui, shutdown);
  try {
    await factory(shim);
  } catch (err) {
    throw new Error(`"${label}" threw during activation`, { cause: err });
  }
  return shim;
}

export async function loadExtension(
  entry: string,
  ctx: PluginContext,
  ui: UIService,
  shutdown?: ShutdownFn,
): Promise<PiShim[]> {
  if (entry.startsWith('npm:')) {
    const paths = resolveNpmExtensionPaths(entry);
    const shims: PiShim[] = [];
    for (const extPath of paths) {
      const mod = await importModule(extPath, entry);
      const shim = await loadModuleAsExtension(mod, entry, ctx, ui, shutdown);
      shims.push(shim);
    }
    return shims;
  }

  const resolved = resolve(entry);
  if (!existsSync(resolved)) {
    throw new Error(`Extension file not found: ${resolved}`);
  }
  const mod = await importModule(resolved, entry);
  const shim = await loadModuleAsExtension(mod, entry, ctx, ui, shutdown);
  return [shim];
}

/**
 * Resolve all Pi extension entries from config.
 * Supports:
 * - npm: specifiers (passed through as-is for loadExtension to handle)
 * - Direct file paths (.ts files)
 * - Directories (looks for index.ts or *.ts files)
 */
export function resolveExtensionEntries(config: PiCompatConfig, ui?: UIService): string[] {
  const entries: string[] = [];

  if (!config.extensions?.length) return entries;

  for (const entry of config.extensions) {
    // npm: specifiers are passed through — resolved at import time
    if (entry.startsWith('npm:')) {
      entries.push(entry);
      continue;
    }

    const resolved = resolve(entry.replace(/^~/, process.env.HOME ?? ''));

    if (!existsSync(resolved)) {
      ui?.notify(`Extension path not found: ${entry}`, 'warning');
      continue;
    }

    const stat = statSync(resolved);

    if (stat.isFile() && resolved.endsWith('.ts')) {
      entries.push(resolved);
    } else if (stat.isDirectory()) {
      // Check for index.ts first
      const indexPath = join(resolved, 'index.ts');
      if (existsSync(indexPath)) {
        entries.push(indexPath);
      } else {
        // Load all .ts files in the directory
        const files = readdirSync(resolved)
          .filter((f) => f.endsWith('.ts') && !f.startsWith('.'))
          .sort()
          .map((f) => join(resolved, f));
        entries.push(...files);
      }
    }
  }

  return entries;
}

/**
 * Load all Pi extensions from resolved entries (file paths and npm: specifiers).
 */
export async function loadAllExtensions(
  config: PiCompatConfig,
  ctx: PluginContext,
  ui: UIService,
  shutdown?: ShutdownFn,
): Promise<PiShim[]> {
  const entries = resolveExtensionEntries(config, ui);
  const shims: PiShim[] = [];

  for (const entry of entries) {
    try {
      const loaded = await loadExtension(entry, ctx, ui, shutdown);
      shims.push(...loaded);
    } catch (err) {
      ui.notify(formatError(entry, err), 'error');
    }
  }

  return shims;
}
