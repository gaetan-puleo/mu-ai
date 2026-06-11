import type { Message } from 'mu-core';
import type { Agent } from '../../agents';
import type { SubAgentRegistry } from '../../subAgents';
import type { Harness } from '../../harness/types';
import type { ChannelManager } from '../types';
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
 * Session-store operations the WebSocket adapter needs that the
 * {@link ChannelManager} doesn't cover (list / history / fork / create / rename
 * / delete). The LIVE conversation itself flows through the manager's channels;
 * here we read a channel's live `messages` when present, falling back to disk.
 * Wire-mapped summaries/history are for the companion; `rawMessages` is the
 * lossless mu-core view for the TUI client.
 */
export interface SessionService {
  agents(): Agent[];
  create(id: string, title?: string): Promise<void>;
  list(): Promise<SessionSummaryWire[]>;
  history(id: string): Promise<PersistedSessionWire | null>;
  rawMessages(id: string): Promise<Message[]>;
  fork(id: string, upToIndex: number): Promise<{ id: string; messages: Message[] }>;
  delete(id: string): Promise<void>;
  rename(id: string, title: string): void;
  readonly subAgents: SubAgentRegistry;
}

export function createSessionService(harness: Harness, manager: ChannelManager): SessionService {
  const { sessions, agents } = harness;

  // A channel's live, in-memory messages (authoritative once a turn has run);
  // otherwise read the persisted copy from disk.
  const messagesOf = async (id: string): Promise<Message[] | undefined> => {
    const live = manager.get(id)?.messages;
    return live ? [...live] : (await sessions.read(id))?.messages;
  };

  return {
    agents: () => agents.list(),
    create: async (id, title) => {
      sessions.create({ id });
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
      return { id: forked.id, messages: [...forked.messages] };
    },
    delete: async (id) => sessions.delete(id),
    rename: (id, title) => sessions.rename(id, title),
    subAgents: harness.subAgents,
  };
}
