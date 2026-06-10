const MU_SOURCE_URL = 'https://github.com/gaetan-puleo/mu-ai';

export interface EnvironmentInfo {
  os: string;
  configDir: string;
  pluginsDir: string;
  skillsDir: string;
  agentsDir: string;
}

export function environmentBlock(info: EnvironmentInfo): string {
  const lines = [
    `Operating system: ${info.os}`,
    `Config directory: ${info.configDir}`,
    `Plugins directory: ${info.pluginsDir}`,
    `Skills directory: ${info.skillsDir}`,
    `Sub-agents directory: ${info.agentsDir}`,
    `mu / harness source code: ${MU_SOURCE_URL}`,
  ];
  return `<env>\n${lines.join('\n')}\n</env>`;
}
