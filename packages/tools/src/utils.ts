import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export { formatError, parseArgs } from 'mu-core';

function isInside(child: string, parent: string): boolean {
  if (child === parent) return true;
  const rel = relative(parent, child);
  if (rel === '' || rel === '.') return true;
  if (rel.startsWith('..') || isAbsolute(rel)) return false;
  // relative() may return ".." without separator on direct escape
  return !rel.split(sep).includes('..');
}

// Walk parents until one exists, so write targets can still be validated.
function closestExisting(p: string): string {
  let current = p;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

/**
 * Sanitize a file path from LLM arguments.
 * Local models often wrap paths in extra quotes or add whitespace.
 *
 * When `cwd` is supplied, relative paths are resolved against it instead of
 * `process.cwd()` — this lets the agent operate on a different working
 * directory than the host process.
 *
 * `restrictToCwd` (opt-in) enforces that the resolved path stays inside
 * the cwd boundary, including after symlink resolution. Returns `null`
 * when the path escapes — callers must surface a tool error.
 */
export function sanitizePath(raw: string, cwd?: string, restrictToCwd = false): string | null {
  let p = raw.trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1).trim();
  }
  if (!isAbsolute(p)) {
    p = resolve(cwd ?? process.cwd(), p);
  }
  if (restrictToCwd && cwd) {
    const normalizedCwd = resolve(cwd);
    if (!isInside(p, normalizedCwd)) {
      return null;
    }
    // Resolve symlinks anywhere along the chain to defeat <cwd>/link -> /etc escapes.
    let realCwd: string;
    try {
      realCwd = realpathSync(normalizedCwd);
    } catch {
      realCwd = normalizedCwd;
    }
    const anchor = closestExisting(p);
    let realAnchor: string;
    try {
      realAnchor = realpathSync(anchor);
    } catch {
      return null;
    }
    const tail = relative(anchor, p);
    const realPath = tail === '' ? realAnchor : resolve(realAnchor, tail);
    if (!isInside(realAnchor, realCwd) || !isInside(realPath, realCwd)) {
      return null;
    }
    return realPath;
  }
  return p;
}

/**
 * Build a cwd accessor that validates the directory exists on first use.
 * Throws a clear error if `getCwd()` returns a path that is missing or
 * not a directory. Validation is cached per resolved path to avoid
 * stat'ing on every tool call.
 */
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

/**
 * Heuristic binary-file detection: a NUL byte in the first 8 KiB.
 * Matches what `git`, `grep`, and most editors do. Cheaper than running
 * a full UTF-8 validator and reliable in practice.
 */
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

/**
 * Read a 1-indexed inclusive line range without loading the whole file.
 * Streams bytes through a file descriptor in fixed chunks and stops once
 * the requested end line is consumed.
 *
 * Returns the joined slice of lines (newline-separated, no trailing newline)
 * and the actual range observed. `totalKnown` is true only if EOF was reached
 * before stopping early.
 */
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

    // Reads next decoded chunk text and a flag indicating EOF.
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
      // Keep last partial line in `pending`; emit complete lines.
      let lineStart = 0;
      for (let i = 0; i < combined.length; i++) {
        if (combined.charCodeAt(i) === 10 /* \n */) {
          const line = combined.slice(lineStart, i);
          if (currentLine >= start && currentLine <= end) out.push(line);
          currentLine++;
          lineStart = i + 1;
          if (currentLine > end) {
            // Past requested range — we don't need the rest.
            // Note: totalLines below is unknown in this branch.
            pending = '';
            break outer;
          }
        }
      }
      pending = combined.slice(lineStart);
    }

    // Flush final partial line on EOF (file without trailing newline).
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

/**
 * Atomic write: writes content to a sibling temp file and renames over the
 * target. `rename` is atomic on POSIX within the same filesystem, so readers
 * never observe a partial write. Creates parent directories as needed.
 *
 * `content` may be a string (written as UTF-8) or a Buffer (raw bytes).
 */
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
    // Best-effort cleanup; ignore if temp never made it to disk.
    try {
      rmSync(tmp, { force: true });
    } catch {
      // ignore
    }
    throw err;
  }
}
