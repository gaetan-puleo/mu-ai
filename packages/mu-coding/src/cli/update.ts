import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getDataDir } from '../config';

function execNpm(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', args, { stdio: 'inherit' });
    proc.on('error', reject);
    proc.on('exit', (code) => resolve(code ?? 1));
  });
}

export async function runUpdate(): Promise<void> {
  // Self-update first (global mu-coding).
  process.stdout.write('updating mu globally…\n');
  const globalCode = await execNpm(['install', '-g', 'mu-coding@latest', '--no-fund', '--no-audit']);
  if (globalCode !== 0) {
    process.stderr.write('global update failed (continuing with plugins)\n');
  }

  // Then update local plugin prefix if present.
  const root = getDataDir();
  if (existsSync(`${root}/package.json`)) {
    process.stdout.write(`updating plugins in ${root}…\n`);
    const code = await execNpm(['update', '--prefix', root, '--no-fund', '--no-audit']);
    if (code !== 0) {
      process.stderr.write('plugin update failed\n');
      process.exit(code);
    }
  }

  process.stdout.write('done.\n');
}
