import type { Message } from 'mu-core';
import type { Agent } from '../../agents';
import type { AgentSession } from '../../session';
import type { SubAgentRegistry } from '../../subAgents';
import type { Harness } from '../../harness/types';
import { messagesToWire, type WireMessage } from './wire';

export interface SessionSummaryWire {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface PersistedSessionWire {
  version?: 1;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: WireMessage[];
}

/**
 * The session-facing operations the WebSocket adapter needs, backed by a harness.
 * Caches live sessions by id (so a session opened for streaming is reused) and
 * exposes both wire-mapped summaries/history (for the companion) and lossless
 * `rawMessages` (for the TUI client). Generalized from arya's runtime.
 */
export interface SessionService {
  agents(): Agent[];
  session(id: string): Promise<AgentSession>;
  create(id: string, title?: string): Promise<void>;
  list(): Promise<SessionSummaryWire[]>;
  history(id: string): Promise<PersistedSessionWire | null>;
  rawMessages(id: string): Promise<Message[]>;
  fork(id: string, upToIndex: number): Promise<{ id: string; messages: Message[] }>;
  delete(id: string): Promise<void>;
  rename(id: string, title: string): void;
  readonly subAgents: SubAgentRegistry;
}

export function createSessionService(harness: Harness): SessionService {
  const { sessions, agents } = harness;
  const cache = new Map<string, AgentSession>();

  const liveSession = async (id: string): Promise<AgentSession> => {
    const cached = cache.get(id);
    if (cached) return cached;
    const stored = await sessions.read(id);
    const session = stored ? await sessions.open(id) : sessions.create({ id });
    cache.set(id, session);
    return session;
  };

  const messagesOf = async (id: string): Promise<Message[] | undefined> =>
    cache.get(id) ? [...cache.get(id)!.messages] : (await sessions.read(id))?.messages;

  return {
    agents: () => agents.list(),
    session: liveSession,
    create: async (id, title) => {
      cache.set(id, sessions.create({ id }));
      if (title) sessions.rename(id, title);
    },
    list: async () => {
      const records = await sessions.list();
      const out: SessionSummaryWire[] = [];
      for (const record of records) {
        const messages = (await messagesOf(record.id)) ?? [];
        out.push({
          id: record.id,
          title: record.title ?? '',
          createdAt: record.createdAt,
          updatedAt: record.createdAt,
          messageCount: messages.filter((m) => m.role !== 'system').length,
        });
      }
      return out;
    },
    history: async (id) => {
      const record = await sessions.get(id);
      const messages = await messagesOf(id);
      if (!record && !messages) return null;
      return {
        version: 1,
        id,
        title: record?.title ?? '',
        createdAt: record?.createdAt ?? Date.now(),
        updatedAt: record?.createdAt ?? Date.now(),
        messages: messagesToWire(messages ?? [], record?.createdAt ?? 0),
      };
    },
    rawMessages: async (id) => (await messagesOf(id)) ?? [],
    fork: async (id, upToIndex) => {
      const forked = await sessions.fork(id, upToIndex);
      cache.set(forked.id, forked);
      return { id: forked.id, messages: [...forked.messages] };
    },
    delete: async (id) => {
      cache.get(id)?.abort();
      cache.delete(id);
      await sessions.delete(id);
    },
    rename: (id, title) => sessions.rename(id, title),
    subAgents: harness.subAgents,
  };
}
