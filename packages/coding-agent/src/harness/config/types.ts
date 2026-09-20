export interface XdgDirs {
  configHome: string;
  dataHome: string;
  stateHome: string;
}

export interface HarnessConfigOptions {
  hostName: string;
  xdg: XdgDirs;
}

export interface HarnessConfig {
  hostName: string;
  configDir: string;
  dataDir: string;
  stateDir: string;
}
