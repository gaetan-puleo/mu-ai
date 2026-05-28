/**
 * JSONL-backed session store.
 *
 *   <dir>/<id>.jsonl      — append-only transcript (one Message per line)
 *   <dir>/<id>.meta.json  — { title, createdAt, updatedAt } sidecar
 *
 * Implements `PersistedSessionStore` so any transport (WS, TUI, RPC) can
 * use it without knowing about the storage format.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type {
  CoreEvent,
  Message,
  Session,
  SessionInit,
  SessionStoreEvent,
} from 'mu-core';
import type { PersistedSessionStore, SessionSummary, StoreChangeKind } from './types';

interface Meta {
  title: string;
  createdAt: number;
  updatedAt?: number;
}

function transcriptFile(dir: string, id: string): string {
  return join(dir, `${id}.jsonl`);
}

function metaFile(dir: string, id: string): string {
  return join(dir, `${id}.meta.json`);
}

function readMessages(file: string): Message[] {
  if (!existsSync(file)) return [];
  const out: Message[] = [];
  let lineNo = 0;
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    lineNo++;
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as Message);
    } catch (err) {
      console.error(`[mu-harness/sessions] malformed transcript line ${lineNo} in ${file}:`, err);
    }
  }
  return out;
}

function readMeta(file: string): Meta | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as Meta;
  } catch {
    return null;
  }
}

function writeMeta(file: string, meta: Meta): void {
  writeFileSync(file, JSON.stringify(meta), 'utf-8');
}

export function createJsonlSessionStore(dir: string): PersistedSessionStore {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const sessions = new Map<string, Session>();
  const coreListeners = new Set<(event: SessionStoreEvent) => void>();
  const watchListeners = new Set<(id: string, kind: StoreChangeKind) => void>();

  function emitCore(event: SessionStoreEvent): void {
    for (const fn of coreListeners) {
      try {
        fn(event);
      } catch (err) {
        console.error('[mu-harness/sessions] core listener threw:', err);
      }
    }
  }

  function emitWatch(id: string, kind: StoreChangeKind): void {
    for (const fn of watchListeners) {
      try {
        fn(id, kind);
      } catch {
        /* listener errors must not propagate */
      }
    }
  }

  function loadSession(id: string): Session | undefined {
    const cached = sessions.get(id);
    if (cached) return cached;
    const meta = readMeta(metaFile(dir, id));
    const transcript = transcriptFile(dir, id);
    if (!meta && !existsSync(transcript)) return undefined;
    const messages = readMessages(transcript);
    const session: Session = {
      id,
      title: meta?.title ?? id,
      messages,
      createdAt: meta?.createdAt ?? Date.now(),
      updatedAt: meta?.updatedAt ?? Date.now(),
    };
    sessions.set(id, session);
    return session;
  }

  function summarise(id: string): SessionSummary {
    const meta = readMeta(metaFile(dir, id));
    const transcript = transcriptFile(dir, id);
    const stat = existsSync(transcript) ? statSync(transcript) : null;
    const messages = existsSync(transcript) ? readMessages(transcript) : [];
    return {
      id,
      title: meta?.title ?? id,
      createdAt: meta?.createdAt ?? stat?.birthtimeMs ?? Date.now(),
      updatedAt: meta?.updatedAt ?? stat?.mtimeMs ?? Date.now(),
      messageCount: messages.length,
    };
  }

  function listIds(): string[] {
    const ids = new Set<string>();
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.jsonl')) ids.add(file.slice(0, -'.jsonl'.length));
      else if (file.endsWith('.meta.json')) ids.add(file.slice(0, -'.meta.json'.length));
    }
    return [...ids];
  }

  function idExists(id: string): boolean {
    return sessions.has(id) || existsSync(metaFile(dir, id)) || existsSync(transcriptFile(dir, id));
  }

  function freshId(): string {
    // Retry on the (rare) same-millisecond collision rather than overwriting an
    // existing transcript / appending to it.
    for (let i = 0; i < 16; i++) {
      const id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      if (!idExists(id)) return id;
    }
    throw new Error('[mu-harness/sessions] failed to generate a unique session id after 16 attempts');
  }

  const store: PersistedSessionStore = {
    list() {
      return listIds().map((id) => loadSession(id)!).filter(Boolean);
    },

    get(id) {
      return loadSession(id);
    },

    create(init: SessionInit = {}) {
      const id = freshId();
      const now = Date.now();
      const session: Session = {
        id,
        title: init.title,
        messages: init.messages ? [...init.messages] : [],
        createdAt: now,
        updatedAt: now,
      };
      sessions.set(id, session);
      writeMeta(metaFile(dir, id), { title: session.title ?? id, createdAt: now, updatedAt: now });
      if (session.messages.length > 0) {
        const file = transcriptFile(dir, id);
        for (const msg of session.messages) {
          appendFileSync(file, `${JSON.stringify(msg)}\n`, 'utf-8');
        }
      }
      emitCore({ type: 'created', session });
      emitWatch(id, 'created');
      return session;
    },

    fork(sourceId, atIndex, init: SessionInit = {}) {
      const source = loadSession(sourceId);
      if (!source) throw new Error(`Cannot fork unknown session "${sourceId}"`);
      if (atIndex < 0 || atIndex >= source.messages.length) {
        throw new Error(`Fork index ${atIndex} out of range (0..${source.messages.length - 1})`);
      }
      const pivot = source.messages[atIndex];
      if (pivot.role !== 'user') {
        throw new Error(`Fork point must be a user message; got role "${pivot.role}" at index ${atIndex}`);
      }
      const id = freshId();
      const now = Date.now();
      const fork: Session = {
        id,
        title: init.title,
        messages: source.messages.slice(0, atIndex + 1),
        createdAt: now,
        updatedAt: now,
        forkedFrom: { sessionId: sourceId, atIndex },
      };
      sessions.set(id, fork);
      writeMeta(metaFile(dir, id), { title: fork.title ?? id, createdAt: now, updatedAt: now });
      const file = transcriptFile(dir, id);
      for (const msg of fork.messages) {
        appendFileSync(file, `${JSON.stringify(msg)}\n`, 'utf-8');
      }
      emitCore({ type: 'created', session: fork });
      emitWatch(id, 'created');
      return fork;
    },

    delete(id) {
      const session = loadSession(id);
      sessions.delete(id);
      let removed = false;
      for (const p of [transcriptFile(dir, id), metaFile(dir, id)]) {
        if (existsSync(p)) {
          unlinkSync(p);
          removed = true;
        }
      }
      if (!removed) return;
      if (session) emitCore({ type: 'deleted', session });
      emitWatch(id, 'deleted');
    },

    touch(id) {
      const session = loadSession(id);
      if (!session) return;
      // Read the existing meta first; if it's unreadable (transient FS error or
      // genuinely missing) we MUST NOT synthesize a new one — doing so would
      // permanently rewrite `createdAt` to "now". Abort the touch instead;
      // callers see an outdated `updatedAt` but the record stays correct.
      const meta = readMeta(metaFile(dir, id));
      if (!meta) return;
      session.updatedAt = Date.now();
      meta.updatedAt = session.updatedAt;
      writeMeta(metaFile(dir, id), meta);
      emitCore({ type: 'updated', session });
      emitWatch(id, 'updated');
    },

    subscribe(listener) {
      coreListeners.add(listener);
      return () => coreListeners.delete(listener);
    },

    summaries() {
      return listIds().map(summarise).sort((a, b) => b.updatedAt - a.updatedAt);
    },

    rename(id, title) {
      const meta = readMeta(metaFile(dir, id)) ?? { title: id, createdAt: Date.now() };
      meta.title = title;
      writeMeta(metaFile(dir, id), meta);
      const session = sessions.get(id);
      if (session) session.title = title;
      emitWatch(id, 'renamed');
      return true;
    },

    watch(fn) {
      watchListeners.add(fn);
      return () => watchListeners.delete(fn);
    },

    persistOnBus(bus, sessionId) {
      const file = transcriptFile(dir, sessionId);
      return bus.subscribe((event: CoreEvent) => {
        const msg = messageFromEvent(event);
        if (!msg) return;
        // Pre-build the full line (JSON + newline) so the single `appendFileSync`
        // call writes a complete record. A crash mid-call can still produce a
        // partial write, but at least no second call can interleave between the
        // JSON bytes and the terminating newline.
        const line = `${JSON.stringify(msg)}\n`;
        try {
          appendFileSync(file, line, 'utf-8');
          store.touch(sessionId);
        } catch (err) {
          console.error(`[mu-harness/sessions] failed to persist ${sessionId}:`, err);
        }
      });
    },
  };

  return store;
}

function messageFromEvent(event: CoreEvent): Message | undefined {
  switch (event.type) {
    case 'user_message':
    case 'assistant_message':
    case 'tool_result':
      return event.message;
    default:
      // `reasoning_message` carries only the reasoning string; it's folded
      // into the following `assistant_message` (`AssistantMessage.reasoning`)
      // and therefore not persisted as a standalone transcript entry.
      return undefined;
  }
}
