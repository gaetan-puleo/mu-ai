import type { ContentPart, LoopEvent, Message, Tool } from 'mu-core';

export type AgentSessionEvent =
  | { type: 'turn_start'; input: Message }
  | LoopEvent
  | { type: 'turn_end' }
  | { type: 'error'; error: unknown };

export interface AgentSession {
  readonly id: string;
  readonly messages: readonly Message[];
  readonly tools: readonly Tool[];
  send(input: string | ContentPart[]): Promise<void>;
  abort(): void;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
}
