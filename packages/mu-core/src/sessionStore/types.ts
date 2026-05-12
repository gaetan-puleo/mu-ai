import type { ChatMessage } from '../types/llm';

/** On-disk session, schema v1. */
export interface StoredSession {
  version: 1;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export type SessionChangeKind = 'created' | 'updated' | 'deleted' | 'renamed';

export type SessionChangeListener = (id: string, kind: SessionChangeKind) => void;

export interface SessionStore {
  list: () => SessionSummary[];
  get: (id: string) => StoredSession | null;
  create: (opts?: { id?: string; title?: string }) => StoredSession;
  delete: (id: string) => boolean;
  rename: (id: string, title: string) => StoredSession | null;
  appendMessage: (id: string, msg: ChatMessage) => StoredSession;
  subscribe: (listener: SessionChangeListener) => () => void;
}
