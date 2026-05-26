/**
 * Standard XDG path layout for harness hosts. Every host (arya, coding-agent,
 * etc.) gets the same structure under `<XDG_*_HOME>/<hostName>/`.
 *
 *   $XDG_CONFIG_HOME/<host>/        — config.json, .env, permissions, agents/, skills/
 *   $XDG_DATA_HOME/<host>/          — sessions/, plugins/
 *   $XDG_STATE_HOME/<host>/         — state.json, history.json
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface XdgPaths {
  hostName: string;
  /** $XDG_CONFIG_HOME or ~/.config */
  configHome: string;
  /** $XDG_DATA_HOME or ~/.local/share */
  dataHome: string;
  /** $XDG_STATE_HOME or ~/.local/state */
  stateHome: string;
  /** $XDG_CONFIG_HOME/<host> */
  configDir: string;
  /** $XDG_DATA_HOME/<host> */
  dataDir: string;
  /** $XDG_STATE_HOME/<host> */
  stateDir: string;
  /** $XDG_CONFIG_HOME/<host>/config.json */
  configFile: string;
  /** $XDG_CONFIG_HOME/<host>/.env */
  envFile: string;
  /** $XDG_CONFIG_HOME/<host>/permissions.json */
  permissionsFile: string;
  /** $XDG_CONFIG_HOME/<host>/agents */
  agentsDir: string;
  /** $XDG_CONFIG_HOME/<host>/skills */
  skillsDir: string;
  /** $XDG_CONFIG_HOME/<host>/tasks */
  tasksDir: string;
  /** $XDG_DATA_HOME/<host>/plugins */
  pluginsDir: string;
  /** $XDG_DATA_HOME/<host>/sessions */
  sessionsDir: string;
  /** $XDG_STATE_HOME/<host>/state.json */
  stateFile: string;
  /** $XDG_STATE_HOME/<host>/history.json */
  historyFile: string;
}

export function createXdgPaths(hostName: string): XdgPaths {
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');

  const configDir = join(configHome, hostName);
  const dataDir = join(dataHome, hostName);
  const stateDir = join(stateHome, hostName);

  return {
    hostName,
    configHome,
    dataHome,
    stateHome,
    configDir,
    dataDir,
    stateDir,
    configFile: join(configDir, 'config.json'),
    envFile: join(configDir, '.env'),
    permissionsFile: join(configDir, 'permissions.json'),
    agentsDir: join(configDir, 'agents'),
    skillsDir: join(configDir, 'skills'),
    tasksDir: join(configDir, 'tasks'),
    pluginsDir: join(dataDir, 'plugins'),
    sessionsDir: join(dataDir, 'sessions'),
    stateFile: join(stateDir, 'state.json'),
    historyFile: join(stateDir, 'history.json'),
  };
}
