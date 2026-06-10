export interface EnvironmentInfo {
  configDir: string;
  pluginsDir: string;
  skillsDir: string;
  agentsDir: string;
}

export function environmentBlock(info: EnvironmentInfo): string {
  const lines = [
    `Config directory: ${info.configDir}`,
    `Plugins directory: ${info.pluginsDir}`,
    `Skills directory: ${info.skillsDir}`,
    `Sub-agents directory: ${info.agentsDir}`,
  ];
  return `<env>\n${lines.join('\n')}\n</env>`;
}
