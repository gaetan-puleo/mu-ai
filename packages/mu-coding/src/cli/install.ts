import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir, getConfigPath, getDataDir } from '../config';

function execNpm(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', args, { stdio: 'inherit' });
    proc.on('error', reject);
    proc.on('exit', (code) => resolve(code ?? 1));
  });
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Append a `plugins[]` entry to the config; idempotent. */
function rememberPlugin(spec: string): void {
  ensureDir(getConfigDir());
  const path = getConfigPath();
  let cfg: { plugins?: string[] } = {};
  if (existsSync(path)) {
    try {
      cfg = JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      /* ignore */
    }
  }
  const set = new Set(cfg.plugins ?? []);
  set.add(spec);
  cfg.plugins = Array.from(set);
  writeFileSync(path, JSON.stringify(cfg, null, 2), 'utf-8');
}

/**
 * `mu install npm:<spec>` — installs into ~/.local/share/mu/node_modules/
 * via plain `npm install <spec> --prefix <root>`.
 */
export async function runInstall(args: string[]): Promise<void> {
  if (args.length === 0) {
    process.stderr.write('usage: mu install <spec> [<spec>…]\n');
    process.exit(1);
  }

  const root = getDataDir();
  ensureDir(root);

  // Ensure a package.json exists so npm install doesn't complain.
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) {
    writeFileSync(pkgPath, JSON.stringify({ name: 'mu-plugins', private: true }, null, 2), 'utf-8');
  }

  for (const spec of args) {
    const bare = spec.startsWith('npm:') ? spec.slice('npm:'.length) : spec;
    process.stdout.write(`installing ${bare} into ${root}\n`);
    const code = await execNpm(['install', bare, '--prefix', root, '--no-fund', '--no-audit']);
    if (code !== 0) {
      process.stderr.write(`install failed for ${bare}\n`);
      process.exit(code);
    }
    rememberPlugin(spec.startsWith('npm:') ? spec : `npm:${bare}`);
  }
}
