import { createReadStream, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ChatMessage } from 'mu-core';
import { getDataDir } from '../config/index';
import { getProjectId, getProjectName } from './project';

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
 * Persist `messages` as JSONL. Async to avoid blocking the event loop on
 * large sessions; callers should `await` to apply backpressure.
 */
export async function saveSession(path: string, messages: ChatMessage[]): Promise<void> {
  const content = messages.length > 0 ? `${messages.map((m) => JSON.stringify(m)).join('\n')}\n` : '';
  await writeFile(path, content, 'utf-8');
}

export function loadSession(path: string): ChatMessage[] {
  try {
    const content = readFileSync(path, 'utf-8').trim();
    if (!content) {
      return [];
    }
    return content
      .split('\n')
      .map((line) => {
        try {
          return JSON.parse(line) as ChatMessage;
        } catch {
          return null;
        }
      })
      .filter((msg): msg is ChatMessage => msg !== null);
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

    const finish = (): void => {
      resolve({ messageCount, preview: preview ?? NO_USER_PREVIEW });
    };

    rl.on('line', (line) => {
      if (!line) return;
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
