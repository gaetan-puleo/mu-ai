import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir, loadConfig, saveConfig } from '../config/index';

const INIT_PACKAGE_JSON = JSON.stringify({ private: true, dependencies: {} }, null, 2);

function ensureDataDir(): string {
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });

  const pkgPath = join(dataDir, 'package.json');
  if (!existsSync(pkgPath)) {
    writeFileSync(pkgPath, INIT_PACKAGE_JSON, 'utf-8');
  }

  return dataDir;
}

function stripNpmPrefix(specifier: string): string {
  if (!specifier.startsWith('npm:')) {
    console.error(`Error: package specifier must start with npm: — got "${specifier}"`);
    process.exit(1);
  }
  return specifier.slice(4);
}

/**
 * Splits a bare specifier (e.g. `foo@1.2.3`, `@scope/foo@^1.0.0`, `foo`) into
 * the package name (used at runtime by `require.resolve`) and an optional
 * install-time version range. Scoped packages keep their leading `@`.
 */
function parseBareSpec(bare: string): { name: string; version?: string } {
  const scoped = bare.startsWith('@');
  const at = bare.indexOf('@', scoped ? 1 : 0);
  if (at === -1) {
    return { name: bare };
  }
  return { name: bare.slice(0, at), version: bare.slice(at + 1) };
}

/** The canonical form we store in `config.plugins`: `npm:<package-name>` (no version). */
function canonicalSpecifier(bare: string): string {
  return `npm:${parseBareSpec(bare).name}`;
}

export async function runInstall(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: mu install npm:<package>');
    process.exit(1);
  }

  const dataDir = ensureDataDir();
  const config = loadConfig();
  const plugins = config.plugins ?? [];

  for (const specifier of args) {
    const bare = stripNpmPrefix(specifier);
    const canonical = canonicalSpecifier(bare);

    console.log(`Installing ${bare}...`);
    try {
      execFileSync('bun', ['add', bare], { cwd: dataDir, stdio: 'inherit' });
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
    const canonical = canonicalSpecifier(bare);
    const { name } = parseBareSpec(bare);

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
