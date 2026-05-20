import process from 'node:process';

import type { Capabilities, PartialCapabilities } from './capabilities';
import type { InputEvent } from './events';
import type { Terminal, TerminalMode } from './types/terminal';

export interface RuntimeEnv {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  isTTY: boolean;
  columns: number;
  rows: number;
}

export interface FeatureContext {
  terminal: Terminal;
  capabilities: Capabilities;
  write: (data: string) => void;
  enableMode: (mode: TerminalMode) => void;
  disableMode: (mode: TerminalMode) => void;
  updateCapabilities: (patch: PartialCapabilities) => void;
  addCleanup: (cleanup: () => void) => void;
}

export interface TuiFeature {
  name: string;
  detect?: (env: RuntimeEnv) => PartialCapabilities | undefined;
  setup?: (ctx: FeatureContext) => void;
  cleanup?: (ctx: FeatureContext) => void;
  handleEvent?: (event: InputEvent, ctx: FeatureContext) => void;
}

export function createRuntimeEnv(terminal: Terminal): RuntimeEnv {
  return {
    env: process.env,
    platform: process.platform,
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    columns: terminal.columns,
    rows: terminal.rows,
  };
}
