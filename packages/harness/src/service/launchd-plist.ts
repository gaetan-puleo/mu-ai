import type { ServiceDescriptor } from './types';

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const stringEl = (value: string): string => `    <string>${escapeXml(value)}</string>`;

/** launchd reverse-DNS label, e.g. "arya" → label as-is (callers pass "ai.arya.gateway"). */
export const launchdLabel = (d: ServiceDescriptor): string => d.launchdLabel ?? d.name;

/**
 * Render a launchd LaunchAgent plist. `RunAtLoad` starts it on login and
 * `KeepAlive` restarts it on unexpected exit (SuccessfulExit=false → don't relaunch
 * after a clean stop). stdout/stderr go to the given log paths.
 */
export function buildLaunchAgentPlist(d: ServiceDescriptor): string {
  if (d.exec.length === 0) throw new Error('ServiceDescriptor.exec must not be empty');
  const env = Object.entries(d.environment ?? {}).filter(([, v]) => typeof v === 'string' && v.trim()) as [
    string,
    string,
  ][];

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '    <key>Label</key>',
    `    <string>${escapeXml(launchdLabel(d))}</string>`,
    '    <key>ProgramArguments</key>',
    '    <array>',
    ...d.exec.map((a) => `    ${stringEl(a)}`),
    '    </array>',
    ...(d.workingDirectory ? ['    <key>WorkingDirectory</key>', stringEl(d.workingDirectory)] : []),
    '    <key>RunAtLoad</key>',
    '    <true/>',
    '    <key>KeepAlive</key>',
    '    <dict>',
    '        <key>SuccessfulExit</key>',
    '        <false/>',
    '    </dict>',
    ...(d.stdoutPath ? ['    <key>StandardOutPath</key>', stringEl(d.stdoutPath)] : []),
    ...(d.stderrPath ? ['    <key>StandardErrorPath</key>', stringEl(d.stderrPath)] : []),
    ...(env.length > 0
      ? [
          '    <key>EnvironmentVariables</key>',
          '    <dict>',
          ...env.flatMap(([k, v]) => [`        <key>${escapeXml(k)}</key>`, `        <string>${escapeXml(v.trim())}</string>`]),
          '    </dict>',
        ]
      : []),
    '</dict>',
    '</plist>',
    '',
  ];
  return lines.join('\n');
}
