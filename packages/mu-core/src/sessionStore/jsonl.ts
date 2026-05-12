/**
 * JSONL-backed session store. One file per session under `{dir}/{id}.jsonl`.
 *
 * Disk format (v1):
 *   Line 1:  {"v":1,"id":"...","title":"...","createdAt":N,"updatedAt":N}
 *   Line 2..N: one ChatMessage JSON object per line.
 *
 * Files that don't start with a v1 header are treated as malformed and
 * ignored by `list()` / `get()`. No automatic migration — operators
 * archive or delete legacy files as they see fit.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newSessionId, nowMs } from '../ids';
import type { ChatMessage } from '../types/llm';
import { deriveTitleFromText } from './title';
import type { SessionChangeKind, SessionChangeListener, SessionStore, SessionSummary, StoredSession } from './types';

interface HeaderRecord {
  v: 1;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

function fileSafeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isHeader(value: unknown): value is HeaderRecord {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    rec.v === 1 &&
    typeof rec.id === 'string' &&
    typeof rec.title === 'string' &&
    typeof rec.createdAt === 'number' &&
    typeof rec.updatedAt === 'number'
  );
}

function readSessionFile(path: string): StoredSession | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const lines = raw.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  let header: HeaderRecord;
  try {
    const parsed = JSON.parse(lines[0]);
    if (!isHeader(parsed)) return null;
    header = parsed;
  } catch {
    return null;
  }
  const messages: ChatMessage[] = [];
  for (let i = 1; i < lines.length; i++) {
    try {
      messages.push(JSON.parse(lines[i]) as ChatMessage);
    } catch {
      // Skip malformed lines; we don't want one bad line to nuke the
      // whole session.
    }
  }
  return {
    version: 1,
    id: header.id,
    title: header.title,
    createdAt: header.createdAt,
    updatedAt: header.updatedAt,
    messages,
  };
}

function writeSessionFile(path: string, session: StoredSession): void {
  const header: HeaderRecord = {
    v: 1,
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
  const body = [JSON.stringify(header), ...session.messages.map((m) => JSON.stringify(m))].join('\n');
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${body}\n`, 'utf8');
  try {
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* tmp may not exist */
    }
    throw err;
  }
}

function summarise(s: StoredSession): SessionSummary {
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: s.messages.length,
  };
}

export interface CreateJSONLSessionStoreOptions {
  dir: string;
}

function newSession(id: string, title?: string): StoredSession {
  const ts = nowMs();
  return {
    version: 1,
    id,
    title: title ?? 'New session',
    createdAt: ts,
    updatedAt: ts,
    messages: [],
  };
}

function listFromDir(dir: string): SessionSummary[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: SessionSummary[] = [];
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const session = readSessionFile(join(dir, name));
    if (session) out.push(summarise(session));
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

interface StoreContext {
  dir: string;
  listeners: Set<SessionChangeListener>;
  pathFor: (id: string) => string;
  readOne: (id: string) => StoredSession | null;
  emit: (id: string, kind: SessionChangeKind) => void;
}

function createStoreContext(dir: string): StoreContext {
  mkdirSync(dir, { recursive: true });
  const listeners = new Set<SessionChangeListener>();
  const pathFor = (id: string): string => join(dir, `${fileSafeId(id)}.jsonl`);
  const readOne = (id: string): StoredSession | null => readSessionFile(pathFor(id));
  const emit = (id: string, kind: SessionChangeKind): void => {
    for (const l of listeners) {
      try {
        l(id, kind);
      } catch {
        // listener errors must not break the store
      }
    }
  };
  return { dir, listeners, pathFor, readOne, emit };
}

export function createJSONLSessionStore(opts: CreateJSONLSessionStoreOptions): SessionStore {
  const ctx = createStoreContext(opts.dir);
  const { listeners, pathFor, readOne, emit } = ctx;

  const create = (o: { id?: string; title?: string } = {}): StoredSession => {
    const id = o.id ?? newSessionId();
    const existing = readOne(id);
    if (existing) return existing;
    const session = newSession(id, o.title);
    writeSessionFile(pathFor(id), session);
    emit(id, 'created');
    return session;
  };

  const remove = (id: string): boolean => {
    const p = pathFor(id);
    if (!existsSync(p)) return false;
    try {
      unlinkSync(p);
      emit(id, 'deleted');
      return true;
    } catch {
      return false;
    }
  };

  const rename = (id: string, title: string): StoredSession | null => {
    const s = readOne(id);
    if (!s) return null;
    const next: StoredSession = { ...s, title: title.trim() || s.title, updatedAt: nowMs() };
    writeSessionFile(pathFor(id), next);
    emit(id, 'renamed');
    return next;
  };

  const saveTranscript = (id: string, messages: ChatMessage[]): StoredSession => {
    const existing = readOne(id);
    const isNew = existing === null;
    const base = existing ?? newSession(id);
    // Derive title from first user message if still default.
    const firstUser = messages.find((m) => m.role === 'user');
    let title = base.title;
    if (firstUser && (title === 'New session' || !title)) {
      title = deriveTitleFromText(firstUser.content);
    }
    const next: StoredSession = {
      ...base,
      title,
      updatedAt: nowMs(),
      messages,
    };
    writeSessionFile(pathFor(id), next);
    emit(id, isNew ? 'created' : 'updated');
    return next;
  };

  return {
    list: () => listFromDir(ctx.dir),
    get: readOne,
    create,
    delete: remove,
    rename,
    saveTranscript,
    subscribe(listener: SessionChangeListener): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}
