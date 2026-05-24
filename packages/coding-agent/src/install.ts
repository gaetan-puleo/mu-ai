import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { getPluginsDir, loadConfig, saveConfig } from './config';

const TRUST_WARNING = 'Plugins run with full system access. Only install from sources you trust.';

function printTrustWarning(): void {
  process.stderr.write(`[mu] ${TRUST_WARNING}\n`);
}

async function denoCache(spec: string): Promise<void> {
  const cmd = new Deno.Command('deno', {
    args: ['cache', spec],
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const { code } = await cmd.output();
  if (code !== 0) {
    throw new Error(`deno cache ${spec} failed with exit code ${code}`);
  }
}

async function installNpm(spec: string): Promise<void> {
  printTrustWarning();
  await denoCache(spec);
  const config = loadConfig();
  const plugins = config.plugins ?? [];
  if (plugins.includes(spec)) {
    process.stdout.write(`[mu] ${spec} is already installed\n`);
    return;
  }
  config.plugins = [...plugins, spec];
  saveConfig(config);
  process.stdout.write(`[mu] installed ${spec}\n`);
}

function installLocalFile(path: string): void {
  printTrustWarning();
  const abs = isAbsolute(path) ? path : resolve(process.cwd(), path);
  if (!existsSync(abs)) {
    throw new Error(`file not found: ${abs}`);
  }
  if (!abs.endsWith('.ts')) {
    throw new Error(`local plugin must be a .ts file: ${abs}`);
  }
  const dir = getPluginsDir();
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, basename(abs));
  copyFileSync(abs, dest);
  process.stdout.write(`[mu] installed ${dest}\n`);
}

function uninstallNpm(spec: string): void {
  const config = loadConfig();
  const plugins = config.plugins ?? [];
  if (!plugins.includes(spec)) {
    process.stderr.write(`[mu] ${spec} is not installed\n`);
    return;
  }
  config.plugins = plugins.filter((p) => p !== spec);
  saveConfig(config);
  process.stdout.write(`[mu] uninstalled ${spec}\n`);
}

export async function install(spec: string): Promise<void> {
  if (spec.startsWith('npm:')) {
    await installNpm(spec);
    return;
  }
  installLocalFile(spec);
}

export function uninstall(spec: string): void {
  if (!spec.startsWith('npm:')) {
    throw new Error(`uninstall expects an npm:<spec>; got ${spec}`);
  }
  uninstallNpm(spec);
}
