import { join } from 'node:path';
import { createHostConfig, createXdgPaths, type HostConfig } from 'mu-harness';

/**
 * coding-agent's host-side config: XDG-standard `~/.config/mu/<kind>/`
 * directories plus a project-local `.mu/<kind>/` override (later entry
 * wins on name collisions, per HostConfig conventions).
 */
export function buildHostConfig(): HostConfig {
  const paths = createXdgPaths('mu');
  const local = join(process.cwd(), '.mu');
  return createHostConfig('mu', {
    pluginsDirs: [paths.pluginsDir],
    permissionsFiles: [paths.permissionsFile, join(local, 'permissions.json')],
    skillsDirs: [paths.skillsDir, join(local, 'skills')],
    subAgentsDirs: [paths.agentsDir, join(local, 'agents')],
  });
}
