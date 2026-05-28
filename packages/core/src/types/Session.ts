import type { Message } from './Message';

/**
 * The persisted unit of conversation state. Stores observe `updatedAt` to
 * know when to persist or re-render lists.
 *
 * Runtime-only working memory (steering/follow-up queues) lives on
 * `TurnState`, not here — so serializers never round-trip transient data.
 */
export interface Session {
  readonly id: string;
  title?: string;
  messages: Message[];
  readonly createdAt: number;
  updatedAt: number;
  /** When the session was created via `store.fork`, points back to the source. */
  readonly forkedFrom?: { sessionId: string; atIndex: number };
}

/**
 * Runtime-only working memory for the current turn. Created by the runtime,
 * never persisted. Keeps steering/follow-up queues out of the Session entity.
 */
export interface TurnState {
  steeringQueue: Message[];
  followUpQueue: Message[];
}
