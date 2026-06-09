import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import type { Terminal } from './types/terminal';

function osc52(text: string): string {
  const payload = Buffer.from(text, 'utf8').toString('base64');
  const seq = `\x1b]52;c;${payload}\x07`;
  if (process.env.TMUX) return `\x1bPtmux;${seq.split('\x1b').join('\x1b\x1b')}\x1b\\`;
  return seq;
}

function nativeTool(): { cmd: string; args: string[] } | undefined {
  if (process.platform === 'darwin') return { cmd: 'pbcopy', args: [] };
  if (process.platform === 'win32') return { cmd: 'clip', args: [] };
  if (process.env.WAYLAND_DISPLAY) return { cmd: 'wl-copy', args: [] };
  if (process.env.DISPLAY) return { cmd: 'xclip', args: ['-selection', 'clipboard'] };
  return undefined;
}

function nativeCopy(text: string): void {
  const tool = nativeTool();
  if (!tool) return;
  try {
    const child = spawn(tool.cmd, tool.args, { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => {});
    child.stdin.on('error', () => {});
    child.stdin.end(text);
  } catch {
    return;
  }
}

export function copyToClipboard(terminal: Terminal, text: string): void {
  terminal.write(osc52(text));
  nativeCopy(text);
}
