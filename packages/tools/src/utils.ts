import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

export function formatError(err: unknown): string {
  if (err instanceof Error) return `Error: ${err.message}`;
  return `Error: ${String(err)}`;
}

export function sanitizePath(raw: string, cwd?: string): string {
  let p = raw.trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1).trim();
  }
  if (!isAbsolute(p)) {
    p = resolve(cwd ?? process.cwd(), p);
  }
  return p;
}

export function validatedCwd(getCwd: () => string): () => string {
  const checked = new Set<string>();
  return () => {
    const cwd = getCwd();
    if (!checked.has(cwd)) {
      let st;
      try {
        st = statSync(cwd);
      } catch {
        throw new Error(`Invalid cwd: directory does not exist: ${cwd}`);
      }
      if (!st.isDirectory()) {
        throw new Error(`Invalid cwd: not a directory: ${cwd}`);
      }
      checked.add(cwd);
    }
    return cwd;
  };
}

export function looksBinary(path: string): boolean {
  const SAMPLE = 8192;
  const buf = Buffer.alloc(SAMPLE);
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const bytes = readSync(fd, buf, 0, SAMPLE, 0);
    for (let i = 0; i < bytes; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function readLineRange(
  path: string,
  start: number,
  end: number,
): { lines: string[]; firstLine: number; lastLine: number; totalKnown: boolean; totalLines: number } {
  const CHUNK = 64 * 1024;
  const buf = Buffer.alloc(CHUNK);
  const fd = openSync(path, 'r');
  try {
    let offset = 0;
    let currentLine = 1;
    let pending = '';
    const out: string[] = [];
    let eof = false;

    const nextChunk = (): string | null => {
      const bytes = readSync(fd, buf, 0, CHUNK, offset);
      if (bytes === 0) {
        eof = true;
        return null;
      }
      offset += bytes;
      return buf.subarray(0, bytes).toString('utf-8');
    };

    outer: while (true) {
      const text = nextChunk();
      if (text === null) break;
      const combined = pending + text;
      let lineStart = 0;
      for (let i = 0; i < combined.length; i++) {
        if (combined.charCodeAt(i) === 10) {
          const line = combined.slice(lineStart, i);
          if (currentLine >= start && currentLine <= end) out.push(line);
          currentLine++;
          lineStart = i + 1;
          if (currentLine > end) {
            pending = '';
            break outer;
          }
        }
      }
      pending = combined.slice(lineStart);
    }

    if (eof && pending.length > 0) {
      if (currentLine >= start && currentLine <= end) out.push(pending);
      currentLine++;
    }

    return {
      lines: out,
      firstLine: start,
      lastLine: start + out.length - 1,
      totalKnown: eof,
      totalLines: eof ? currentLine - 1 : -1,
    };
  } finally {
    closeSync(fd);
  }
}

export function writeAtomic(path: string, content: string | Buffer): void {
  const parentDir = dirname(path);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
  const tmp = `${path}.mu-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    if (typeof content === 'string') {
      writeFileSync(tmp, content, 'utf-8');
    } else {
      writeFileSync(tmp, content);
    }
    renameSync(tmp, path);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
    }
    throw err;
  }
}
