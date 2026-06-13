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

export interface ClipboardImage {
  mime: string;
  data: Uint8Array;
}

function runCapture(cmd: string, args: string[]): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(undefined);
      return;
    }
    const chunks: Buffer[] = [];
    child.on('error', () => resolve(undefined));
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('close', (code) => {
      const buf = Buffer.concat(chunks);
      resolve(code === 0 && buf.byteLength > 0 ? buf : undefined);
    });
  });
}

/**
 * Reads an image from the OS clipboard, if one is present. Returns undefined when
 * the clipboard holds no image (e.g. plain text) or no supported tool is available.
 *
 * Linux needs `wl-clipboard` (Wayland) or `xclip` (X11) installed.
 */
export async function readClipboardImage(): Promise<ClipboardImage | undefined> {
  if (process.platform === 'darwin') {
    // osascript can only probe a known type; PNG covers screenshots and most copies.
    const tmp = `${process.env.TMPDIR ?? '/tmp'}/mu-clipboard-${process.pid}.png`;
    const script = [
      `set imageData to the clipboard as «class PNGf»`,
      `set fileRef to open for access POSIX file "${tmp}" with write permission`,
      `set eof fileRef to 0`,
      `write imageData to fileRef`,
      `close access fileRef`,
    ].flatMap((line) => ['-e', line]);
    const ok = await runCapture('osascript', script);
    if (ok === undefined && !(await fileHasBytes(tmp))) return undefined;
    const bytes = await readAndUnlink(tmp);
    return bytes ? { mime: 'image/png', data: bytes } : undefined;
  }

  if (process.platform === 'win32') {
    const ps =
      "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }";
    const out = await runCapture('powershell.exe', ['-NonInteractive', '-NoProfile', '-Command', ps]);
    if (!out) return undefined;
    const b64 = out.toString('utf8').trim();
    if (!b64) return undefined;
    const data = Buffer.from(b64, 'base64');
    return data.byteLength > 0 ? { mime: 'image/png', data: new Uint8Array(data) } : undefined;
  }

  // Linux: try Wayland then X11.
  if (process.env.WAYLAND_DISPLAY) {
    const wl = await runCapture('wl-paste', ['-t', 'image/png']);
    if (wl) return { mime: 'image/png', data: new Uint8Array(wl) };
  }
  if (process.env.DISPLAY) {
    const x = await runCapture('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']);
    if (x) return { mime: 'image/png', data: new Uint8Array(x) };
  }
  return undefined;
}

async function fileHasBytes(path: string): Promise<boolean> {
  try {
    const { stat } = await import('node:fs/promises');
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

async function readAndUnlink(path: string): Promise<Uint8Array | undefined> {
  try {
    const { readFile, unlink } = await import('node:fs/promises');
    const buf = await readFile(path);
    await unlink(path).catch(() => {});
    return buf.byteLength > 0 ? new Uint8Array(buf) : undefined;
  } catch {
    return undefined;
  }
}
