import type { Message } from './Message';

/**
 * The unit of conversation state. The runtime mutates the message and
 * queue arrays in place during a run; stores observe `updatedAt` to know
 * when to persist or re-render lists.
 */
export interface Session {
  readonly id: string;
  title?: string;
  messages: Message[];
  steeringQueue: Message[];
  followUpQueue: Message[];
  readonly createdAt: number;
  updatedAt: number;
  /** When the session was created via `store.fork`, points back to the source. */
  readonly forkedFrom?: { sessionId: string; atIndex: number };
}
