import type { ServiceExec } from './types';

/**
 * Whether systemd "linger" is enabled for a user. Without it, a `--user` service
 * stops when the user's last session ends — so an autonomous host would die on
 * logout. Returns undefined if loginctl is unavailable or the value is unreadable.
 */
export async function readLingerEnabled(user: string, exec: ServiceExec): Promise<boolean | undefined> {
  try {
    const { code, stdout } = await exec('loginctl', ['show-user', user, '-p', 'Linger']);
    if (code !== 0) return undefined;
    const line = stdout.split('\n').map((s) => s.trim()).find((s) => s.startsWith('Linger='));
    const value = line?.split('=')[1]?.trim().toLowerCase();
    return value === 'yes' ? true : value === 'no' ? false : undefined;
  } catch {
    return undefined;
  }
}

/** Enable linger so the user service survives logout. Needs root, so prefixes sudo
 * unless `sudo: false`. Returns true on success. */
export async function enableLinger(user: string, exec: ServiceExec, sudo = true): Promise<boolean> {
  const argv = sudo ? ['sudo', 'loginctl', 'enable-linger', user] : ['loginctl', 'enable-linger', user];
  try {
    const { code } = await exec(argv[0], argv.slice(1));
    return code === 0;
  } catch {
    return false;
  }
}
