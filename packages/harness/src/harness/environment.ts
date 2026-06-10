const HARNESS_SOURCE_URL = 'https://github.com/gaetan-puleo/mu-ai';

export interface EnvironmentInfo {
  os: string;
  configDir: string;
  pluginsDir: string;
  skillsDir: string;
  agentsDir: string;
  hostName: string;
  hostSourceUrl?: string;
}

export function environmentBlock(info: EnvironmentInfo): string {
  const lines = [
    `Operating system: ${info.os}`,
    `Config directory: ${info.configDir}`,
    `Plugins directory: ${info.pluginsDir}`,
    `Skills directory: ${info.skillsDir}`,
    `Sub-agents directory: ${info.agentsDir}`,
    `Harness (mu) source code: ${HARNESS_SOURCE_URL}`,
  ];
  if (info.hostSourceUrl) lines.push(`${info.hostName} source code: ${info.hostSourceUrl}`);
  return `<env>\n${lines.join('\n')}\n</env>`;
}
