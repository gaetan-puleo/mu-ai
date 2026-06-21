/** How a long-running host (e.g. an autonomous agent's `serve`) is registered with
 * the OS service manager so it survives terminal/login exit. Product-agnostic: the
 * consumer supplies the name, executable, and paths; the renderers and controller
 * turn that into a systemd user unit (Linux) or launchd agent (macOS). */
export interface ServiceDescriptor {
  /** Service identifier. Linux unit `${name}.service`; default launchd label `${name}`. */
  name: string;
  description?: string;
  /** Executable + args, e.g. ["/home/u/.local/bin/arya", "serve"]. */
  exec: string[];
  workingDirectory?: string;
  environment?: Record<string, string | undefined>;
  /** launchd reverse-DNS label; defaults to `name`. */
  launchdLabel?: string;
  /** Log file paths (launchd writes these directly; systemd uses the journal). */
  stdoutPath?: string;
  stderrPath?: string;
  /** systemd `KillMode=process` — only the main process is awaited on stop. Needed
   * when the service spawns container monitors (podman conmon) that linger in the
   * cgroup. Off by default. */
  killModeProcess?: boolean;
}

export type ServiceState = 'running' | 'stopped' | 'unknown';

export interface ServiceStatus {
  /** Installed (unit/plist present and registered). */
  installed: boolean;
  /** Enabled to start at boot/login. */
  enabled: boolean;
  state: ServiceState;
  /** Absolute path of the unit/plist file, if resolvable. */
  path?: string;
}

/** Minimal async exec used by the controller. Injectable so tests assert the
 * commands without mutating the host. */
export type ServiceExec = (
  cmd: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface ServiceController {
  /** "systemd" | "launchd". */
  readonly kind: string;
  install(): Promise<void>;
  uninstall(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  status(): Promise<ServiceStatus>;
}
