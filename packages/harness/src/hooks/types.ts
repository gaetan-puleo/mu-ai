import type { ContentPart, Message, Tool } from 'mu-core';

export interface PreparedRequest {
  system?: string;
  tools?: Tool[];
  messages?: Message[];
}

export interface AgentSessionHooks {
  sessionStart?(): void | Promise<void>;
  prepareRequest?(req: { system: string; tools: Tool[] }): PreparedRequest | void | Promise<PreparedRequest | void>;
  beforeToolCall?(call: { name: string; input: unknown }): void | ContentPart[] | Promise<void | ContentPart[]>;
  afterToolCall?(call: { name: string; result: ContentPart[] }): void | ContentPart[] | Promise<void | ContentPart[]>;
}
