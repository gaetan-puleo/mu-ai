/**
 * Where the host stores its configuration on disk.
 *
 * Harness modules (permissions, skills, sub-agents, plugin-loader) ask
 * the host where to look; the host decides (XDG, project-relative, custom).
 *
 * Path arrays are in precedence order: later entries override earlier ones
 * when the same name appears twice (e.g. project skill overrides global).
 */
export interface HostConfig {
  hostName: string;
  pluginsDirs: string[];
  permissionsFiles: string[];
  skillsDirs: string[];
  subAgentsDirs: string[];
}

export function createHostConfig(hostName: string, overrides: Partial<Omit<HostConfig, 'hostName'>> = {}): HostConfig {
  return {
    hostName,
    pluginsDirs: overrides.pluginsDirs ?? [],
    permissionsFiles: overrides.permissionsFiles ?? [],
    skillsDirs: overrides.skillsDirs ?? [],
    subAgentsDirs: overrides.subAgentsDirs ?? [],
  };
}
