import type { ContentPart, LoopEvent, Message, Tool } from 'mu-core';

export type AgentSessionEvent =
  | { type: 'turn_start'; input: Message }
  | LoopEvent
  | { type: 'turn_end' }
  | { type: 'error'; error: unknown };

/** The request the provider sees for a turn, assembled from the live session. */
export interface AssembledRequest {
  /** Final system prompt: base system + prepareRequest hook injections + tool prompt blocks. */
  system: string;
  /** Final tool set (after prepareRequest hooks — may differ from session.tools, e.g. per-agent filtering). */
  tools: readonly Tool[];
  /** Final message list (system message + body + any hook-injected messages). */
  messages: readonly Message[];
}

export interface AgentSession {
  readonly id: string;
  readonly model?: string;
  readonly messages: readonly Message[];
  readonly tools: readonly Tool[];
  /** Assemble the request from the CURRENT in-memory session — what the next turn would send. */
  assembleRequest?(): Promise<AssembledRequest>;
  /** Exact token count of `text` via the model's own tokenizer, when the provider supports it. */
  countTokens?(text: string): Promise<number | undefined>;
  /** The active model's context window in tokens, when reportable. */
  contextWindow?(): Promise<number | undefined>;
  /** Summarize older messages (keeping the system + last N) to free context. */
  compact?(opts?: { keepLastTurns?: number }): Promise<void>;
  send(input: string | ContentPart[]): Promise<void>;
  abort(): void;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
}
