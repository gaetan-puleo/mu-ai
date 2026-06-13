import type { ContentPart, LoopEvent, Message, Tool } from 'mu-core';

export type AgentSessionEvent =
  | { type: 'turn_start'; input: Message }
  | LoopEvent
  | { type: 'turn_end' }
  | { type: 'error'; error: unknown };

/** The exact payload sent to the provider on a turn — what the model actually saw. */
export interface AssembledRequest {
  /** Final system prompt: base system + prepareRequest hook injections + tool prompt blocks. */
  system: string;
  /** Final tool set sent (after prepareRequest hooks — may differ from session.tools, e.g. per-agent filtering). */
  tools: readonly Tool[];
  /** Final message list sent (system message + body + any hook-injected messages). */
  messages: readonly Message[];
}

export interface AgentSession {
  readonly id: string;
  readonly messages: readonly Message[];
  readonly tools: readonly Tool[];
  /** The last request assembled and sent to the provider. Undefined before the first turn. */
  readonly lastRequest?: AssembledRequest;
  send(input: string | ContentPart[]): Promise<void>;
  abort(): void;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
}
