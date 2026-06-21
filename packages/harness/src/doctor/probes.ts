import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';

/** Reusable, side-effect-free probes that a {@link Check} can build on. All probes
 * resolve a boolean and never reject — a failed probe is a normal diagnostic
 * outcome, not an error the caller has to guard against. */

/** True if a TCP connection to `host:port` opens within `timeoutMs`. Used to tell
 * "is something listening here" without assuming any protocol. The socket is torn
 * down on every exit path so probing does not leak descriptors. */
export function tcpProbe(host: string, port: number, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const socket = createConnection({ host, port });
    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/** True if `cmd` resolves to an executable on PATH. Uses the platform's own
 * resolver (`where` on Windows, `which` elsewhere) so it honors PATHEXT and the
 * real lookup rules. Any error or non-zero exit means "not available". */
export function commandAvailable(cmd: string): Promise<boolean> {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    execFile(finder, [cmd], (err) => resolve(!err));
  });
}
