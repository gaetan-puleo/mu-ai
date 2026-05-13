import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getDataDir } from '../config';

interface OutdatedEntry {
  current?: string;
  wanted?: string;
  latest?: string;
  location?: string;
}

function execCapture(cmd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    proc.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString('utf-8');
    });
    proc.on('exit', (code) => resolve({ code: code ?? 0, stdout }));
    proc.on('error', () => resolve({ code: 1, stdout }));
  });
}

export async function runOutdated(): Promise<void> {
  const root = getDataDir();
  if (!existsSync(`${root}/package.json`)) {
    process.stdout.write('no plugins installed (and self-update check via npm is global)\n');
    return;
  }

  const { stdout } = await execCapture('npm', ['outdated', '--json', '--prefix', root]);
  let parsed: Record<string, OutdatedEntry> = {};
  try {
    parsed = JSON.parse(stdout || '{}') as Record<string, OutdatedEntry>;
  } catch {
    process.stdout.write(stdout);
    return;
  }
  const names = Object.keys(parsed);
  if (names.length === 0) {
    process.stdout.write('everything up to date.\n');
    return;
  }
  process.stdout.write(`${names.length} package${names.length === 1 ? '' : 's'} outdated:\n`);
  for (const name of names) {
    const e = parsed[name] ?? {};
    process.stdout.write(`  ${name}: ${e.current ?? '?'} → ${e.latest ?? '?'}\n`);
  }
}
