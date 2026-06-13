import type { ContentPart, Message, Tool } from 'mu-core';

export interface PreparedRequest {
  system?: string;
  tools?: Tool[];
  messages?: Message[];
}

/** Context handed to `afterTurn` — inspect usage and trigger compaction without owning the message array. */
export interface AfterTurnContext {
  messages: readonly Message[];
  countTokens(text: string): Promise<number | undefined>;
  contextWindow(): Promise<number | undefined>;
  /** Summarize older messages (keeping the system + last N), replacing them in place. */
  compact(opts?: { keepLastTurns?: number }): Promise<void>;
}

export interface AgentSessionHooks {
  sessionStart?(): void | Promise<void>;
  prepareRequest?(req: { system: string; tools: Tool[] }): PreparedRequest | void | Promise<PreparedRequest | void>;
  beforeToolCall?(call: { name: string; input: unknown }): void | ContentPart[] | Promise<void | ContentPart[]>;
  afterToolCall?(call: { name: string; result: ContentPart[] }): void | ContentPart[] | Promise<void | ContentPart[]>;
  /** Fires after a turn completes (not on abort) — used for auto-compaction and memory writes. */
  afterTurn?(ctx: AfterTurnContext): void | Promise<void>;
}
