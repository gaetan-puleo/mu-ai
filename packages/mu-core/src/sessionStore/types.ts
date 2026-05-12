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
  /**
   * Save the exact transcript. Overwrites the entire session file so the
   * stored messages match the session's in-memory state 1:1. This is the
   * canonical persistence path — no reconstruction, no diffing.
   */
  saveTranscript: (id: string, messages: ChatMessage[]) => StoredSession;
  subscribe: (listener: SessionChangeListener) => () => void;
}
