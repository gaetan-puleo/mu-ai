import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir, loadConfig, saveConfig } from './config';

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

    console.log(`Installing ${bare}...`);
    try {
      execSync(`bun add ${bare}`, { cwd: dataDir, stdio: 'inherit' });
    } catch {
      console.error(`Failed to install ${bare}`);
      process.exit(1);
    }

    // Add to plugins if not already present
    const existing = plugins.some((p) => (typeof p === 'string' ? p : p.name) === specifier);
    if (!existing) {
      plugins.push(specifier);
    }

    console.log(`✓ ${specifier}`);
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

    console.log(`Removing ${bare}...`);
    try {
      execSync(`bun remove ${bare}`, { cwd: dataDir, stdio: 'inherit' });
    } catch {
      console.error(`Failed to remove ${bare}`);
      process.exit(1);
    }

    plugins = plugins.filter((p) => (typeof p === 'string' ? p : p.name) !== specifier);

    console.log(`✓ Removed ${specifier}`);
  }

  saveConfig({ plugins });
}
