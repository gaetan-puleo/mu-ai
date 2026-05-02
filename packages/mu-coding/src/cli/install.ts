import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalNpmSpecifier, getDataDir, loadConfig, parseBareNpmSpec, saveConfig } from '../config/index';

const INIT_PACKAGE_JSON = JSON.stringify({ private: true, dependencies: {} }, null, 2);

export function ensureDataDir(): string {
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });

  const pkgPath = join(dataDir, 'package.json');
  if (!existsSync(pkgPath)) {
    writeFileSync(pkgPath, INIT_PACKAGE_JSON, 'utf-8');
  }

  return dataDir;
}

/**
 * Install an npm package into the mu data dir using `bun add`. Shared by the
 * `mu install` CLI and the runtime auto-installer (pluginLoader). `bare` is
 * the spec without the `npm:` prefix (e.g. `mu-coding-agents`,
 * `@scope/foo@^1.0.0`). When `silent`, stdout is suppressed (used by the
 * runtime path so the TUI isn't garbled at startup).
 */
export function installNpmPackage(bare: string, options: { silent?: boolean } = {}): void {
  const dataDir = ensureDataDir();
  execFileSync('bun', ['add', bare], {
    cwd: dataDir,
    stdio: options.silent ? 'pipe' : 'inherit',
  });
}

function stripNpmPrefix(specifier: string): string {
  if (!specifier.startsWith('npm:')) {
    console.error(`Error: package specifier must start with npm: — got "${specifier}"`);
    process.exit(1);
  }
  return specifier.slice(4);
}

export async function runInstall(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: mu install npm:<package>');
    process.exit(1);
  }

  ensureDataDir();
  const config = loadConfig();
  const plugins = config.plugins ?? [];

  for (const specifier of args) {
    const bare = stripNpmPrefix(specifier);
    const canonical = canonicalNpmSpecifier(bare);

    console.log(`Installing ${bare}...`);
    try {
      installNpmPackage(bare);
    } catch (err) {
      console.error(`Failed to install ${bare}: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }

    // Add to plugins if not already present (compare by canonical form so
    // `npm:foo` and `npm:foo@1.2.3` deduplicate correctly).
    const existing = plugins.some((p) => (typeof p === 'string' ? p : p.name) === canonical);
    if (!existing) {
      plugins.push(canonical);
    }

    console.log(`✓ ${canonical}`);
  }

  saveConfig({ plugins });
}

export async function runUninstall(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: mu uninstall npm:<package>');
    process.exit(1);
  }

  const dataDir = ensureDataDir();
  const config = loadConfig();
  let plugins = config.plugins ?? [];

  for (const specifier of args) {
    const bare = stripNpmPrefix(specifier);
    const canonical = canonicalNpmSpecifier(bare);
    const { name } = parseBareNpmSpec(bare);

    console.log(`Removing ${name}...`);
    try {
      execFileSync('bun', ['remove', name], { cwd: dataDir, stdio: 'inherit' });
    } catch (err) {
      console.error(`Failed to remove ${name}: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }

    plugins = plugins.filter((p) => (typeof p === 'string' ? p : p.name) !== canonical);

    console.log(`✓ Removed ${canonical}`);
  }

  saveConfig({ plugins });
}
