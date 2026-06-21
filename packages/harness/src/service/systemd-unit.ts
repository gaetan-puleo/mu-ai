import type { ServiceDescriptor } from './types';

const LINE_BREAKS = /[\r\n]/;

const assertNoBreaks = (value: string, label: string): void => {
  if (LINE_BREAKS.test(value)) throw new Error(`${label} cannot contain CR or LF.`);
};

/** Quote a value for systemd if it contains whitespace, quotes, or backslashes. */
const escapeArg = (value: string): string => {
  assertNoBreaks(value, 'systemd unit value');
  if (!/[\s"\\]/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};

const envLines = (env: ServiceDescriptor['environment']): string[] => {
  if (!env) return [];
  return Object.entries(env)
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([k, v]) => {
      assertNoBreaks(k, 'systemd env name');
      assertNoBreaks(v as string, 'systemd env value');
      return `Environment=${escapeArg(`${k}=${(v as string).trim()}`)}`;
    });
};

/**
 * Render a systemd user unit. Mirrors the hardening from established hosts:
 * `After/Wants=network-online.target` (don't race the network), `Restart=always`
 * with `RestartSec=5`, and optional `KillMode=process` for hosts that spawn
 * container monitors. `WantedBy=default.target` installs it for the user session.
 */
export function buildSystemdUnit(d: ServiceDescriptor): string {
  if (d.exec.length === 0) throw new Error('ServiceDescriptor.exec must not be empty');
  const description = (d.description?.trim() || d.name).replace(LINE_BREAKS, ' ');
  const lines = [
    '[Unit]',
    `Description=${description}`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${d.exec.map(escapeArg).join(' ')}`,
    'Restart=always',
    'RestartSec=5',
    ...(d.killModeProcess ? ['KillMode=process'] : []),
    ...(d.workingDirectory ? [`WorkingDirectory=${escapeArg(d.workingDirectory)}`] : []),
    ...envLines(d.environment),
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ];
  return lines.join('\n');
}
