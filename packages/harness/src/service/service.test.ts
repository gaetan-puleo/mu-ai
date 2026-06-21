import { expect, test } from 'vitest';
import { buildLaunchAgentPlist } from './launchd-plist';
import { buildSystemdUnit } from './systemd-unit';
import { readLingerEnabled } from './linger';
import { createServiceController, type ServiceEnv } from './controller';
import type { ServiceDescriptor, ServiceExec } from './types';

const descriptor: ServiceDescriptor = {
  name: 'arya',
  description: 'Arya autonomous host',
  exec: ['/home/u/.local/bin/arya', 'serve'],
  workingDirectory: '/home/u/project',
  environment: { ARYA_TOKEN: 'secret', EMPTY: '' },
  launchdLabel: 'ai.arya.gateway',
  stdoutPath: '/home/u/.arya/out.log',
};

test('buildSystemdUnit renders a hardened user unit', () => {
  const unit = buildSystemdUnit(descriptor);
  expect(unit).toContain('Description=Arya autonomous host');
  expect(unit).toContain('After=network-online.target');
  expect(unit).toContain('Wants=network-online.target');
  expect(unit).toContain('ExecStart=/home/u/.local/bin/arya serve');
  expect(unit).toContain('Restart=always');
  expect(unit).toContain('RestartSec=5');
  expect(unit).toContain('WorkingDirectory=/home/u/project');
  expect(unit).toContain('Environment=ARYA_TOKEN=secret');
  expect(unit).not.toContain('EMPTY='); // empty env values are dropped
  expect(unit).toContain('WantedBy=default.target');
  expect(unit).not.toContain('KillMode'); // off unless requested
});

test('buildSystemdUnit quotes args with spaces and adds KillMode when asked', () => {
  const unit = buildSystemdUnit({
    name: 'x',
    exec: ['/bin/x', '--flag', 'a b'],
    killModeProcess: true,
  });
  expect(unit).toContain('ExecStart=/bin/x --flag "a b"');
  expect(unit).toContain('KillMode=process');
});

test('buildSystemdUnit rejects newline injection and empty exec', () => {
  expect(() => buildSystemdUnit({ name: 'x', exec: [] })).toThrow();
  expect(() => buildSystemdUnit({ name: 'x', exec: ['/bin/x'], description: 'a\nb' })).not.toThrow(); // sanitized
  expect(() => buildSystemdUnit({ name: 'x', exec: ['/bin/x\nExecStop=rm'] })).toThrow();
});

test('buildLaunchAgentPlist renders a LaunchAgent with KeepAlive + env + escaping', () => {
  const plist = buildLaunchAgentPlist({ ...descriptor, environment: { A: '1', B: 'x&y' } });
  expect(plist).toContain('<string>ai.arya.gateway</string>');
  expect(plist).toContain('<string>/home/u/.local/bin/arya</string>');
  expect(plist).toContain('<string>serve</string>');
  expect(plist).toContain('<key>RunAtLoad</key>');
  expect(plist).toContain('<key>KeepAlive</key>');
  expect(plist).toContain('<string>x&amp;y</string>'); // XML-escaped
  expect(plist).toContain('<string>/home/u/.arya/out.log</string>');
});

/** Fake env that records exec calls and keeps an in-memory filesystem. */
const fakeEnv = (
  platform: NodeJS.Platform,
  exec: ServiceExec,
): { env: ServiceEnv; files: Map<string, string>; calls: string[][] } => {
  const files = new Map<string, string>();
  const calls: string[][] = [];
  const env: ServiceEnv = {
    home: '/home/u',
    user: 'u',
    platform,
    exec: (cmd, args) => {
      calls.push([cmd, ...args]);
      return exec(cmd, args);
    },
    fs: {
      writeFile: async (p, d) => void files.set(p, d),
      readFile: async (p) => files.get(p),
      exists: async (p) => files.has(p),
      rm: async (p) => void files.delete(p),
      mkdirp: async () => {},
    },
  };
  return { env, files, calls };
};

const ok: ServiceExec = async () => ({ code: 0, stdout: '', stderr: '' });

test('systemd controller install writes the unit and reloads + enables', async () => {
  const { env, files, calls } = fakeEnv('linux', ok);
  const ctl = createServiceController(descriptor, { linger: false }, env);
  expect(ctl.kind).toBe('systemd');

  await ctl.install();
  expect(files.has('/home/u/.config/systemd/user/arya.service')).toBe(true);
  expect(calls).toContainEqual(['systemctl', '--user', 'daemon-reload']);
  expect(calls).toContainEqual(['systemctl', '--user', 'enable', 'arya']);

  await ctl.start();
  expect(calls).toContainEqual(['systemctl', '--user', 'start', 'arya']);
});

test('systemd controller status reports running from is-active', async () => {
  const exec: ServiceExec = async (_cmd, args) => {
    if (args.includes('is-active')) return { code: 0, stdout: 'active\n', stderr: '' };
    if (args.includes('is-enabled')) return { code: 0, stdout: 'enabled\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const { env } = fakeEnv('linux', exec);
  env.fs.writeFile('/home/u/.config/systemd/user/arya.service', 'unit');
  const status = await createServiceController(descriptor, {}, env).status();
  expect(status).toMatchObject({ installed: true, enabled: true, state: 'running' });
});

test('launchd controller install writes a plist and loads it; status parses PID', async () => {
  const exec: ServiceExec = async (_cmd, args) =>
    args[0] === 'list' ? { code: 0, stdout: '{ "PID" = 4321; };', stderr: '' } : { code: 0, stdout: '', stderr: '' };
  const { env, files, calls } = fakeEnv('darwin', exec);
  const ctl = createServiceController(descriptor, {}, env);
  expect(ctl.kind).toBe('launchd');

  await ctl.install();
  expect(files.has('/home/u/Library/LaunchAgents/ai.arya.gateway.plist')).toBe(true);
  expect(calls.some((c) => c[0] === 'launchctl' && c[1] === 'load')).toBe(true);

  const status = await ctl.status();
  expect(status).toMatchObject({ installed: true, enabled: true, state: 'running' });
});

test('createServiceController throws on unsupported platforms', () => {
  const { env } = fakeEnv('win32', ok);
  expect(() => createServiceController(descriptor, {}, env)).toThrow(/Unsupported platform/);
});

test('readLingerEnabled parses loginctl output', async () => {
  const yes: ServiceExec = async () => ({ code: 0, stdout: 'Linger=yes\n', stderr: '' });
  const no: ServiceExec = async () => ({ code: 0, stdout: 'Linger=no\n', stderr: '' });
  expect(await readLingerEnabled('u', yes)).toBe(true);
  expect(await readLingerEnabled('u', no)).toBe(false);
});
