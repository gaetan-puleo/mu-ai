import type { ContentPart, Message } from 'mu-core';
import type { SessionCatalog, SessionRecord } from './catalog';
import { persistTo } from './persist';
import type { SessionStore, StoredSession } from './store';
import type { AgentSession } from './types';

export interface ReviveInput {
  id: string;
  model?: string;
  messages?: Message[];
}

export interface SessionManagerOptions {
  store: SessionStore;
  catalog: SessionCatalog;
  revive(input: ReviveInput): AgentSession;
  newId(): string;
  cwd?: string;
  title?(input: { id: string; text: string }): void;
}

export interface SessionManager {
  create(options?: { id?: string; model?: string; cwd?: string }): AgentSession;
  open(id: string): Promise<AgentSession>;
  fork(id: string, upToIndex: number): Promise<AgentSession>;
  list(filter?: { cwd?: string; parentId?: string }): Promise<SessionRecord[]>;
  get(id: string): Promise<SessionRecord | undefined>;
  /** Read a session's stored messages by id without instantiating a live session. */
  read(id: string): Promise<StoredSession | undefined>;
  rename(id: string, title: string): void;
  delete(id: string): Promise<void>;
}

const inputText = (input: string | ContentPart[]): string =>
  typeof input === 'string' ? input : input.map((part) => (part.type === 'text' ? part.text : '')).join('');

const onFirstMessage = (session: AgentSession, fire: (input: { id: string; text: string }) => void): AgentSession => {
  let pending = !session.messages.some((message) => message.role === 'user');
  return {
    get id() {
      return session.id;
    },
    get messages() {
      return session.messages;
    },
    send: async (input) => {
      if (pending) {
        pending = false;
        fire({ id: session.id, text: inputText(input) });
      }
      await session.send(input);
    },
    abort: session.abort,
    subscribe: session.subscribe,
  };
};

export const createSessionManager = (
  { store, catalog, revive, newId, cwd, title }: SessionManagerOptions,
): SessionManager => ({
  create: (options) => {
    const id = options?.id ?? newId();
    catalog.record(id, { cwd: options?.cwd ?? cwd });
    const session = persistTo(store, revive({ id, model: options?.model }));
    return title ? onFirstMessage(session, title) : session;
  },
  open: async (id) => {
    const stored = await store.load(id);
    return persistTo(store, revive({ id: stored.id, messages: stored.messages }), stored.messages.length);
  },
  fork: async (id, upToIndex) => {
    const stored = await store.load(id);
    const messages = stored.messages.slice(0, upToIndex + 1);
    const forkId = newId();
    catalog.record(forkId, { cwd: catalog.get(id)?.cwd ?? cwd });
    const session = revive({ id: forkId, messages });
    await store.append(forkId, messages);
    return persistTo(store, session, messages.length);
  },
  list: async (filter) => catalog.list(filter),
  get: async (id) => catalog.get(id),
  read: async (id) => {
    try {
      return await store.load(id);
    } catch {
      return undefined;
    }
  },
  rename: (id, title) => catalog.setTitle(id, title),
  delete: async (id) => {
    for (const child of catalog.list({ parentId: id })) {
      await store.delete(child.id);
      catalog.delete(child.id);
    }
    await store.delete(id);
    catalog.delete(id);
  },
});
