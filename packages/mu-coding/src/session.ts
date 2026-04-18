import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage } from 'mu-provider';
import { getDataDir } from './config';
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

export function saveSession(path: string, messages: ChatMessage[]): void {
  writeFileSync(path, `${messages.map((m) => JSON.stringify(m)).join('\n')}\n`, 'utf-8');
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

export function getLatestSession(): string | null {
  const files = getSortedSessionFiles();
  return files.length ? join(getProjectSessionsDir(), files[0]) : null;
}

export function listSessions(): SessionInfo[] {
  try {
    const dir = getProjectSessionsDir();
    mkdirSync(dir, { recursive: true });
    const files = getSortedSessionFiles();
    const project = getProjectName();

    return files.map((file) => {
      const path = join(dir, file);
      const stat = statSync(path);
      const messages = loadSession(path);
      const firstUserMsg = messages.find((m) => m.role === 'user');
      const preview = firstUserMsg ? firstUserMsg.content.slice(0, 80).replace(/\n/g, ' ') : '(empty)';

      return {
        path,
        name: file.replace('.jsonl', ''),
        date: stat.mtime,
        messageCount: messages.length,
        preview,
        project,
      };
    });
  } catch {
    return [];
  }
}
