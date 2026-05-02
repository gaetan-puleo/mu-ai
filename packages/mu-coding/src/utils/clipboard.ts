import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ImageAttachment } from 'mu-core';

const CLIPBOARD_TIMEOUT = 3000;

function tryExecFile(file: string, args: string[]): boolean {
  try {
    execFileSync(file, args, { stdio: 'pipe', timeout: CLIPBOARD_TIMEOUT });
    return true;
  } catch {
    return false;
  }
}

function tryShell(command: string): boolean {
  try {
    execSync(command, { stdio: 'pipe', timeout: CLIPBOARD_TIMEOUT });
    return true;
  } catch {
    return false;
  }
}

function commandExists(name: string): boolean {
  return tryExecFile('which', [name]);
}

function extractMacImage(tmpFile: string): boolean {
  if (commandExists('pngpaste')) {
    return tryExecFile('pngpaste', [tmpFile]);
  }
  // Each `-e` is a discrete script line — passing as separate args avoids shell quoting traps.
  return tryExecFile('osascript', [
    '-e',
    'tell application "System Events"',
    '-e',
    'set imgData to the clipboard as «class PNGf»',
    '-e',
    `set fp to open for access POSIX file "${tmpFile}" with write permission`,
    '-e',
    'write imgData to fp',
    '-e',
    'close access fp',
    '-e',
    'end tell',
  ]);
}

function extractLinuxImage(tmpFile: string): boolean {
  // xclip / wl-paste write to stdout; redirection still requires a shell.
  // tmpFile is constructed from tmpdir() + a numeric timestamp, so quoting is safe.
  if (tryShell(`xclip -selection clipboard -t image/png -o > "${tmpFile}"`)) {
    return true;
  }
  return tryShell(`wl-paste --type image/png > "${tmpFile}"`);
}

function extractPlatformImage(tmpFile: string): boolean {
  if (process.platform === 'darwin') {
    return extractMacImage(tmpFile);
  }
  if (process.platform === 'linux') {
    return extractLinuxImage(tmpFile);
  }
  return false;
}

function readTmpAsAttachment(tmpFile: string): ImageAttachment | null {
  if (!existsSync(tmpFile)) {
    return null;
  }
  if (statSync(tmpFile).size === 0) {
    unlinkSync(tmpFile);
    return null;
  }
  const buffer = readFileSync(tmpFile);
  unlinkSync(tmpFile);
  return { data: buffer.toString('base64'), mimeType: 'image/png', name: 'clipboard.png' };
}

export function readClipboardImage(): ImageAttachment | null {
  const tmpFile = join(tmpdir(), `mu-clip-${Date.now()}.png`);
  try {
    if (!extractPlatformImage(tmpFile)) {
      return null;
    }
    return readTmpAsAttachment(tmpFile);
  } catch {
    if (existsSync(tmpFile)) {
      unlinkSync(tmpFile);
    }
    return null;
  }
}
