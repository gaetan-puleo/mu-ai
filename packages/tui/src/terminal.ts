import process from 'node:process';
import {
  type Capabilities,
  createDefaultCapabilities,
  mergeCapabilities,
  type PartialCapabilities,
} from './capabilities';
import type { Terminal, TerminalMode } from './types/terminal';

async function drainStdin(opts?: { maxMs?: number; idleMs?: number }): Promise<void> {
  const maxMs = opts?.maxMs ?? 200;
  const idleMs = opts?.idleMs ?? 30;

  let lastDataTime = Date.now();
  const onData = (): void => {
    lastDataTime = Date.now();
  };

  process.stdin.on('data', onData);
  const endTime = Date.now() + maxMs;

  try {
    while (true) {
      const now = Date.now();
      if (now - endTime >= 0) break;
      if (now - lastDataTime >= idleMs) break;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(idleMs, endTime - now)));
    }
  } finally {
    process.stdin.removeListener('data', onData);
  }
}

export interface ProcessTerminalOptions {
  capabilities?: PartialCapabilities;
  alternateScreen?: boolean;
  bracketedPaste?: boolean;
  focusEvents?: boolean;
  keyboard?: boolean;
  mouse?: boolean | { drag?: boolean; motion?: boolean; pixel?: boolean };
}

const MODE_ENABLE: Record<TerminalMode, string> = {
  alternateScreen: '\x1b[?1049h',
  bracketedPaste: '\x1b[?2004h',
  focusEvents: '\x1b[?1004h',
  sgrMouse: '\x1b[?1006h',
  mouseDrag: '\x1b[?1002h',
  mouseMotion: '\x1b[?1003h',
  pixelMouse: '\x1b[?1016h',
  synchronizedOutput: '\x1b[?2026h',
  kittyKeyboard: '\x1b[>1u',
  modifyOtherKeys: '\x1b[>4;2m',
};

const MODE_DISABLE: Record<TerminalMode, string> = {
  alternateScreen: '\x1b[?1049l',
  bracketedPaste: '\x1b[?2004l',
  focusEvents: '\x1b[?1004l',
  sgrMouse: '\x1b[?1006l',
  mouseDrag: '\x1b[?1002l',
  mouseMotion: '\x1b[?1003l',
  pixelMouse: '\x1b[?1016l',
  synchronizedOutput: '\x1b[?2026l',
  kittyKeyboard: '\x1b[<u',
  modifyOtherKeys: '\x1b[>4;0m',
};

export class ProcessTerminal implements Terminal {
  private _columns: number;
  private _rows: number;
  private onData: ((data: string) => void) | null = null;
  private onResize: (() => void) | null = null;
  private cleanupHandlers: Array<() => void> = [];
  private stdinDataHandler: ((chunk: string) => void) | null = null;
  private stdoutResizeHandler: (() => void) | null = null;
  private started = false;
  private readonly enabledModes: TerminalMode[] = [];
  readonly capabilities: Capabilities;

  constructor(private readonly options: ProcessTerminalOptions = {}) {
    this._columns = process.stdout.columns || 80;
    this._rows = process.stdout.rows || 24;
    this.capabilities = mergeCapabilities(createDefaultCapabilities(), options.capabilities);
  }

  get columns(): number {
    return this._columns;
  }

  get rows(): number {
    return this._rows;
  }

  write(data: string): void {
    if (process.stdout.isTTY) {
      process.stdout.write(data);
    }
  }

  hideCursor(): void {
    this.write('\x1b[?25l');
  }

  showCursor(): void {
    this.write('\x1b[?25h');
  }

  clearScreen(): void {
    this.write('\x1b[2J\x1b[H');
  }

  clearLine(): void {
    this.write('\x1b[2K');
  }

  clearFromCursor(): void {
    this.write('\x1b[0J');
  }

  moveBy(lines: number): void {
    if (lines > 0) {
      this.write(`\x1b[${lines}B`);
    } else if (lines < 0) {
      this.write(`\x1b[${-lines}A`);
    }
  }

  enableMode(mode: TerminalMode): void {
    if (!process.stdout.isTTY || this.enabledModes.includes(mode)) return;
    this.write(MODE_ENABLE[mode]);
    this.enabledModes.push(mode);
  }

  disableMode(mode: TerminalMode): void {
    const index = this.enabledModes.lastIndexOf(mode);
    if (index === -1) return;
    this.write(MODE_DISABLE[mode]);
    this.enabledModes.splice(index, 1);
  }

  enableMouse(): void {
    this.enableMode('sgrMouse');
    this.enableMode('mouseDrag');
  }

  disableMouse(): void {
    this.disableMode('pixelMouse');
    this.disableMode('mouseMotion');
    this.disableMode('mouseDrag');
    this.disableMode('sgrMouse');
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    if (this.started || !(process.stdin.isTTY && process.stdout.isTTY)) {
      return;
    }

    this.started = true;
    this.onData = onInput;
    this.onResize = onResize;

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    this.stdinDataHandler = (chunk: string) => {
      this.onData?.(chunk);
    };
    process.stdin.on('data', this.stdinDataHandler);

    this.stdoutResizeHandler = () => {
      this._columns = process.stdout.columns || 80;
      this._rows = process.stdout.rows || 24;
      this.onResize?.();
    };
    process.stdout.on('resize', this.stdoutResizeHandler);

    this._columns = process.stdout.columns || 80;
    this._rows = process.stdout.rows || 24;

    const handleSigInt = (): void => {
      this.stop();
      if (process.pid) process.kill(process.pid, 'SIGINT');
    };
    process.once('SIGINT', handleSigInt);
    this.cleanupHandlers.push(() => process.removeListener('SIGINT', handleSigInt));

    const handleSigTerm = (): void => {
      this.stop();
      if (process.pid) process.kill(process.pid, 'SIGTERM');
    };
    process.once('SIGTERM', handleSigTerm);
    this.cleanupHandlers.push(() => process.removeListener('SIGTERM', handleSigTerm));

    const handleSigHup = (): void => {
      this.stop();
      if (process.pid) process.kill(process.pid, 'SIGHUP');
    };
    process.once('SIGHUP', handleSigHup);
    this.cleanupHandlers.push(() => process.removeListener('SIGHUP', handleSigHup));

    const handleExit = (): void => {
      this.stopNow();
    };
    process.once('exit', handleExit);
    this.cleanupHandlers.push(() => process.removeListener('exit', handleExit));

    this.applyStartupModes();
    this.hideCursor();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    this.write('\x1b[?2026l');
    this.restoreModes();
    this.write('\x1b[0m\x1b]8;;\x07');
    this.showCursor();

    if (this.stdinDataHandler) {
      process.stdin.removeListener('data', this.stdinDataHandler);
      this.stdinDataHandler = null;
    }
    if (this.stdoutResizeHandler) {
      process.stdout.removeListener('resize', this.stdoutResizeHandler);
      this.stdoutResizeHandler = null;
    }

    void this.restoreInputAfterDrain();
    this.onData = null;
    this.onResize = null;

    for (const cleanup of this.cleanupHandlers) {
      try {
        cleanup();
      } catch {
      }
    }
    this.cleanupHandlers.length = 0;
  }

  private applyStartupModes(): void {
    if (this.options.alternateScreen) this.enableMode('alternateScreen');
    if (this.options.bracketedPaste) this.enableMode('bracketedPaste');
    if (this.options.focusEvents) this.enableMode('focusEvents');
    if (this.options.keyboard) {
      this.enableMode('kittyKeyboard');
      this.enableMode('modifyOtherKeys');
    }

    if (this.options.mouse) {
      this.enableMode('sgrMouse');
      if (this.options.mouse === true || this.options.mouse.drag) this.enableMode('mouseDrag');
      if (this.options.mouse !== true && this.options.mouse.motion) this.enableMode('mouseMotion');
      if (this.options.mouse !== true && this.options.mouse.pixel) this.enableMode('pixelMouse');
    }
  }

  private restoreModes(): void {
    for (let i = this.enabledModes.length - 1; i >= 0; i--) {
      this.write(MODE_DISABLE[this.enabledModes[i]]);
    }
    this.enabledModes.length = 0;
  }

  private async restoreInputAfterDrain(): Promise<void> {
    try {
      await drainStdin();
    } catch {
    } finally {
      this.restoreInputNow();
    }
  }

  private stopNow(): void {
    if (!this.started) return;
    this.started = false;
    this.write('\x1b[?2026l');
    this.restoreModes();
    this.write('\x1b[0m\x1b]8;;\x07');
    this.showCursor();
    this.restoreInputNow();
  }

  private restoreInputNow(): void {
    process.stdin.pause();
    process.stdin.setRawMode(false);
  }
}
