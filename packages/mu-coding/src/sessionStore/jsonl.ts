import { existsSync, promises as fsp, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Message } from 'mu-core';

/**
 * First line of every session file. The discriminator `kind` lets readers
 * tell headers from messages without keeping the body in a wrapper record.
 *
 * `version: 1` is reserved for future schema migrations; bump only when the
 * on-disk format changes incompatibly (e.g. new required fields).
 */
export interface SessionHeader {
  kind: 'header';
  version: 1;
  id: string;
  createdAt: number;
  cwd: string;
  model?: string;
  baseUrl: string;
  source?: string;
}

export interface SessionFileSummary {
  id: string;
  path: string;
  mtimeMs: number;
  header: SessionHeader;
}

export interface LoadedSession {
  header: SessionHeader;
  messages: Message[];
}

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Create the file and write the header. Throws if the file already exists —
 * callers wanting to resume an existing file should call `readSessionHeader`
 * and skip straight to `appendMessage`.
 */
export async function writeHeader(filePath: string, header: SessionHeader): Promise<void> {
  if (existsSync(filePath)) {
    throw new Error(`session file already exists: ${filePath}`);
  }
  ensureParentDir(filePath);
  await fsp.writeFile(filePath, `${JSON.stringify(header)}\n`, { flag: 'wx' });
}

/**
 * Atomic, append-only message write. Uses `fs.appendFile` so concurrent
 * writers (we don't expect any today, but it's free safety) cannot interleave
 * partial JSON.
 */
export async function appendMessage(filePath: string, message: Message): Promise<void> {
  await fsp.appendFile(filePath, `${JSON.stringify(message)}\n`);
}

function parseLineOrThrow(line: string, lineNo: number): unknown {
  try {
    return JSON.parse(line);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`corrupt session file at line ${lineNo}: ${msg}`, { cause: err });
  }
}

function assertHeader(value: unknown, filePath: string): SessionHeader {
  if (!value || typeof value !== 'object') {
    throw new Error(`missing header in ${filePath}`);
  }
  const candidate = value as { kind?: unknown; version?: unknown };
  if (candidate.kind !== 'header') {
    throw new Error(`first line of ${filePath} is not a session header`);
  }
  if (candidate.version !== 1) {
    throw new Error(`unsupported session schema version in ${filePath}: ${String(candidate.version)}`);
  }
  return value as SessionHeader;
}

export async function readSession(filePath: string): Promise<LoadedSession> {
  const raw = await fsp.readFile(filePath, 'utf-8');
  const lines = raw.split('\n');
  const messages: Message[] = [];
  let header: SessionHeader | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue; // tolerate trailing blank line + accidental blanks
    const parsed = parseLineOrThrow(line, i + 1);
    if (i === 0 || header === null) {
      header = assertHeader(parsed, filePath);
      continue;
    }
    messages.push(parsed as Message);
  }
  if (!header) throw new Error(`empty session file: ${filePath}`);
  return { header, messages };
}

/**
 * Read only the first line of a file. Cheaper than `readSession` when the
 * caller only needs metadata (e.g. listing sessions for a picker).
 */
export async function readSessionHeader(filePath: string): Promise<SessionHeader> {
  const fh = await fsp.open(filePath, 'r');
  try {
    // 4 KiB is generous: a header serialises to ~200 bytes today.
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const slice = buf.slice(0, bytesRead).toString('utf-8');
    const newlineIdx = slice.indexOf('\n');
    const firstLine = newlineIdx >= 0 ? slice.slice(0, newlineIdx) : slice;
    if (!firstLine) throw new Error(`empty session file: ${filePath}`);
    return assertHeader(parseLineOrThrow(firstLine, 1), filePath);
  } finally {
    await fh.close();
  }
}

/**
 * List session files in a directory. Returns summaries sorted by mtime
 * descending (newest first), which is what the picker UI wants.
 *
 * Corrupt files are silently skipped. We deliberately don't surface them
 * here — the picker has nowhere to render a per-row error today, and a
 * stray corrupt file would block the whole list. A `--repair` CLI is a
 * future enhancement.
 */
export async function listSessions(dir: string): Promise<SessionFileSummary[]> {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir);
  const summaries: SessionFileSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue;
    const filePath = join(dir, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    let header: SessionHeader;
    try {
      header = await readSessionHeader(filePath);
    } catch {
      continue;
    }
    summaries.push({
      id: header.id,
      path: filePath,
      mtimeMs: stat.mtimeMs,
      header,
    });
  }
  summaries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return summaries;
}
