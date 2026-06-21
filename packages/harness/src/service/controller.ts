import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, platform as osPlatform, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { buildLaunchAgentPlist, launchdLabel } from './launchd-plist';
import { enableLinger } from './linger';
import { buildSystemdUnit } from './systemd-unit';
import type { ServiceController, ServiceDescriptor, ServiceExec, ServiceStatus } from './types';

export interface ServiceEnv {
  home: string;
  user: string;
  platform: NodeJS.Platform;
  exec: ServiceExec;
  fs: {
    writeFile(path: string, data: string): Promise<void>;
    readFile(path: string): Promise<string | undefined>;
    exists(path: string): Promise<boolean>;
    rm(path: string): Promise<void>;
    mkdirp(path: string): Promise<void>;
  };
}

const nodeExec: ServiceExec = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
      resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });

/** Default environment wired to the real OS (node fs / child_process / os). */
export const nodeServiceEnv = (): ServiceEnv => ({
  home: homedir(),
  user: userInfo().username,
  platform: osPlatform(),
  exec: nodeExec,
  fs: {
    writeFile: (path, data) => writeFile(path, data, 'utf8'),
    readFile: async (path) => {
      try {
        return await readFile(path, 'utf8');
      } catch {
        return undefined;
      }
    },
    exists: async (path) => existsSync(path),
    rm: async (path) => {
      await rm(path, { force: true });
    },
    mkdirp: async (path) => {
      await mkdir(path, { recursive: true });
    },
  },
});

export interface ServiceControllerOptions {
  /** Enable systemd linger on install (best-effort) so the service survives logout. */
  linger?: boolean;
}

const systemdController = (d: ServiceDescriptor, env: ServiceEnv, opts: ServiceControllerOptions): ServiceController => {
  const unitPath = join(env.home, '.config', 'systemd', 'user', `${d.name}.service`);
  const ctl = (...args: string[]) => env.exec('systemctl', ['--user', ...args]);

  return {
    kind: 'systemd',
    install: async () => {
      await env.fs.mkdirp(dirname(unitPath));
      await env.fs.writeFile(unitPath, buildSystemdUnit(d));
      await ctl('daemon-reload');
      await ctl('enable', d.name);
      if (opts.linger) await enableLinger(env.user, env.exec);
    },
    uninstall: async () => {
      await ctl('disable', d.name);
      await ctl('stop', d.name);
      await env.fs.rm(unitPath);
      await ctl('daemon-reload');
    },
    start: async () => {
      await ctl('start', d.name);
    },
    stop: async () => {
      await ctl('stop', d.name);
    },
    restart: async () => {
      await ctl('restart', d.name);
    },
    status: async (): Promise<ServiceStatus> => {
      const installed = await env.fs.exists(unitPath);
      const enabled = (await ctl('is-enabled', d.name)).code === 0;
      const active = await ctl('is-active', d.name);
      const state = active.stdout.trim() === 'active' ? 'running' : installed ? 'stopped' : 'unknown';
      return { installed, enabled, state, path: unitPath };
    },
  };
};

const launchdController = (d: ServiceDescriptor, env: ServiceEnv): ServiceController => {
  const label = launchdLabel(d);
  const plistPath = join(env.home, 'Library', 'LaunchAgents', `${label}.plist`);
  const ctl = (...args: string[]) => env.exec('launchctl', args);

  return {
    kind: 'launchd',
    install: async () => {
      await env.fs.mkdirp(dirname(plistPath));
      await env.fs.writeFile(plistPath, buildLaunchAgentPlist(d));
      await ctl('load', plistPath);
    },
    uninstall: async () => {
      await ctl('unload', plistPath);
      await env.fs.rm(plistPath);
    },
    start: async () => {
      await ctl('start', label);
    },
    stop: async () => {
      await ctl('stop', label);
    },
    restart: async () => {
      await ctl('stop', label);
      await ctl('start', label);
    },
    status: async (): Promise<ServiceStatus> => {
      const installed = await env.fs.exists(plistPath);
      const listed = await ctl('list', label);
      const loaded = listed.code === 0;
      // `launchctl list <label>` prints `"PID" = <n>;` only while a process is live.
      const running = loaded && /"PID"\s*=\s*\d+/.test(listed.stdout);
      const state = running ? 'running' : installed ? 'stopped' : 'unknown';
      return { installed, enabled: loaded, state, path: plistPath };
    },
  };
};

/**
 * Resolve the OS-appropriate {@link ServiceController} for a host service.
 * systemd (user scope) on Linux, launchd (LaunchAgent) on macOS. Throws on
 * unsupported platforms — callers should surface a "manage it manually" hint.
 */
export function createServiceController(
  descriptor: ServiceDescriptor,
  opts: ServiceControllerOptions = {},
  env: ServiceEnv = nodeServiceEnv(),
): ServiceController {
  if (env.platform === 'darwin') return launchdController(descriptor, env);
  if (env.platform === 'linux') return systemdController(descriptor, env, opts);
  throw new Error(`Unsupported platform for service install: ${env.platform}`);
}
