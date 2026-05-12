import { createReadStream, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ChatMessage } from 'mu-core';
import { getDataDir } from '../config/index';
import { getProjectId, getProjectName } from './project';

/**
 * v1 JSONL header — matches the schema written by mu-core's
 * `createJSONLSessionStore`. Lines after the header are one ChatMessage
 * per line. Legacy files without this header still load (every line is
 * parsed as a ChatMessage and the header parse just fails harmlessly).
 */
interface SessionHeader {
  v: 1;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

function isHeader(value: unknown): value is SessionHeader {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return rec.v === 1;
}

function getProjectSessionsDir(): string {
  return join(getDataDir(), 'sessions', getProjectId());
}

function getSortedSessionFiles(): string[] {
  try {
    const dir = getProjectSessionsDir();
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export interface SessionInfo {
  path: string;
  name: string;
  date: Date;
  messageCount: number;
  preview: string;
  project: string;
}

export function generateSessionPath(): string {
  const dir = getProjectSessionsDir();
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return join(dir, `${ts}.jsonl`);
}

/**
 * Persist `messages` as JSONL with a v1 header on line 1 (interop with
 * mu-core's `createJSONLSessionStore`). Async to avoid blocking the event
 * loop on large sessions; callers should `await` to apply backpressure.
 */
export async function saveSession(path: string, messages: ChatMessage[]): Promise<void> {
  const now = Date.now();
  const header: SessionHeader = {
    v: 1,
    id: basename(path, '.jsonl'),
    title: 'mu-coding session',
    createdAt: now,
    updatedAt: now,
  };
  const lines = [JSON.stringify(header), ...messages.map((m) => JSON.stringify(m))];
  await writeFile(path, `${lines.join('\n')}\n`, 'utf-8');
}

export function loadSession(path: string): ChatMessage[] {
  try {
    const content = readFileSync(path, 'utf-8').trim();
    if (!content) {
      return [];
    }
    const rawLines = content.split('\n');
    const messages: ChatMessage[] = [];
    let startIndex = 0;
    // Skip the v1 header line if present (writes after this commit always
    // produce one; pre-existing files won't and fall through unchanged).
    try {
      const first = JSON.parse(rawLines[0] ?? '');
      if (isHeader(first)) startIndex = 1;
    } catch {
      // not a header — treat all lines as messages
    }
    for (let i = startIndex; i < rawLines.length; i++) {
      try {
        messages.push(JSON.parse(rawLines[i]) as ChatMessage);
      } catch {
        // skip malformed line
      }
    }
    return messages;
  } catch {
    return [];
  }
}

interface SessionPeek {
  messageCount: number;
  preview: string;
}

const PREVIEW_LENGTH = 80;
const NO_USER_PREVIEW = '(no user message)';
const EMPTY_PEEK: SessionPeek = { messageCount: 0, preview: '(empty)' };

/**
 * In-memory cache of session metadata, keyed by absolute path. Entries are
 * invalidated when the file's mtime changes (a fresh `saveSession` after a
 * new message bumps mtime). Lifetime is the process — no on-disk index.
 */
const peekCache = new Map<string, { mtimeMs: number; peek: SessionPeek }>();

function extractUserPreview(line: string): string | null {
  try {
    const msg = JSON.parse(line) as ChatMessage;
    if (msg && msg.role === 'user' && typeof msg.content === 'string') {
      return msg.content.slice(0, PREVIEW_LENGTH).replace(/\n/g, ' ');
    }
  } catch {
    // Skip malformed lines.
  }
  return null;
}

/**
 * Stream a session file line-by-line so memory use is bounded regardless of
 * file size, and we can stop expensive `JSON.parse` work as soon as we've
 * captured the first user message.
 */
async function peekSessionStreaming(path: string): Promise<SessionPeek> {
  return new Promise((resolve) => {
    const stream = createReadStream(path, { encoding: 'utf-8', highWaterMark: 64 * 1024 });
    const rl = createInterface({ input: stream });
    let messageCount = 0;
    let preview: string | null = null;
    let isFirstLine = true;

    const finish = (): void => {
      resolve({ messageCount, preview: preview ?? NO_USER_PREVIEW });
    };

    rl.on('line', (line) => {
      if (!line) return;
      // Skip the v1 header on line 1, if present. Pre-existing files
      // without a header fall through and have line 1 treated as a
      // message — same behaviour as before.
      if (isFirstLine) {
        isFirstLine = false;
        try {
          const parsed = JSON.parse(line);
          if (isHeader(parsed)) return;
        } catch {
          // not a header, fall through to count this line as a message
        }
      }
      messageCount++;
      if (preview !== null) return;
      preview = extractUserPreview(line);
    });
    rl.on('close', finish);
    stream.on('error', () => resolve(EMPTY_PEEK));
  });
}

async function peekSessionCached(path: string, mtimeMs: number): Promise<SessionPeek> {
  const cached = peekCache.get(path);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.peek;
  }
  const peek = await peekSessionStreaming(path);
  peekCache.set(path, { mtimeMs, peek });
  return peek;
}

/** Test/maintenance helper — drop the in-memory peek cache. */
export function clearSessionCache(): void {
  peekCache.clear();
}

export function getLatestSession(): string | null {
  const files = getSortedSessionFiles();
  return files.length ? join(getProjectSessionsDir(), files[0]) : null;
}

/**
 * Resolve session metadata for the picker. Each file is peeked concurrently
 * (typically just a few hundred bytes per file), and successive picker opens
 * hit the in-memory cache keyed by mtime.
 */
export async function listSessionsAsync(): Promise<SessionInfo[]> {
  let dir: string;
  try {
    dir = getProjectSessionsDir();
    mkdirSync(dir, { recursive: true });
  } catch {
    return [];
  }
  const files = getSortedSessionFiles();
  const project = getProjectName();

  const results = await Promise.all(
    files.map(async (file) => {
      const path = join(dir, file);
      try {
        const fileStat = await stat(path);
        const peek = await peekSessionCached(path, fileStat.mtimeMs);
        return {
          path,
          name: file.replace('.jsonl', ''),
          date: fileStat.mtime,
          messageCount: peek.messageCount,
          preview: peek.preview,
          project,
        } satisfies SessionInfo;
      } catch {
        return null;
      }
    }),
  );

  return results.filter((s): s is SessionInfo => s !== null);
}
