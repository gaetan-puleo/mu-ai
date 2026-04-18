import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ImageAttachment } from 'mu-provider';

const CLIPBOARD_TIMEOUT = 3000;

function tryExecSync(command: string): boolean {
  try {
    execSync(command, { stdio: 'pipe', timeout: CLIPBOARD_TIMEOUT });
    return true;
  } catch {
    return false;
  }
}

function extractPlatformImage(tmpFile: string): boolean {
  if (process.platform === 'darwin') {
    if (tryExecSync('which pngpaste')) {
      return tryExecSync(`pngpaste "${tmpFile}"`);
    }
    return tryExecSync(
      `osascript -e 'tell application "System Events" -e 'set imgData to the clipboard as «class PNGf»' -e 'set fp to open for access POSIX file "${tmpFile}" with write permission' -e 'write imgData to fp' -e 'close access fp' -e 'end tell'`,
    );
  }
  if (process.platform === 'linux') {
    if (tryExecSync(`xclip -selection clipboard -t image/png -o > "${tmpFile}"`)) {
      return true;
    }
    return tryExecSync(`wl-paste --type image/png > "${tmpFile}"`);
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
