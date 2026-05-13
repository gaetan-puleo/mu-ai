import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Message, Plugin, Session } from 'mu-core';

export interface StoredSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

export interface SessionSummary {
  id: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface SessionStore {
  list(): SessionSummary[];
  load(id: string): StoredSession | null;
  delete(id: string): boolean;
  /** Plugin form: wires automatic persistence into Mu. */
  plugin(): Plugin;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function sessionFile(dir: string, id: string): string {
  return join(dir, `${id}.jsonl`);
}

function readMessages(file: string): Message[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  const out: Message[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as Message);
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

export function createJsonlStore(dir: string): SessionStore {
  ensureDir(dir);

  // Track per-session offset so we only append new messages.
  const written = new Map<string, number>();

  const list = (): SessionSummary[] => {
    if (!existsSync(dir)) return [];
    const out: SessionSummary[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.jsonl')) continue;
      const id = file.slice(0, -'.jsonl'.length);
      const messages = readMessages(join(dir, file));
      const stat = statSync(join(dir, file));
      out.push({
        id,
        createdAt: messages[0]?.ts ?? stat.birthtimeMs,
        updatedAt: stat.mtimeMs,
        messageCount: messages.length,
      });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  };

  const load = (id: string): StoredSession | null => {
    const file = sessionFile(dir, id);
    if (!existsSync(file)) return null;
    const messages = readMessages(file);
    const stat = statSync(file);
    return {
      id,
      createdAt: messages[0]?.ts ?? stat.birthtimeMs,
      updatedAt: stat.mtimeMs,
      messages,
    };
  };

  const remove = (id: string): boolean => {
    const file = sessionFile(dir, id);
    if (!existsSync(file)) return false;
    unlinkSync(file);
    written.delete(id);
    return true;
  };

  const attachSession = (session: Session): void => {
    const file = sessionFile(dir, session.id);
    // Initialise the offset to the current message count (rehydrated sessions
    // already have those persisted).
    written.set(session.id, session.messages().length);

    session.on((event) => {
      if (event.type !== 'message_appended') return;
      if (event.message.meta?.transient) return;
      try {
        appendFileSync(file, `${JSON.stringify(event.message)}\n`, 'utf-8');
        written.set(session.id, (written.get(session.id) ?? 0) + 1);
      } catch {
        // disk errors must not break the loop
      }
    });
  };

  const plugin = (): Plugin => ({
    name: 'mu-coding-store',
    register(api) {
      api.onSession(attachSession);
    },
  });

  return { list, load, delete: remove, plugin };
}
