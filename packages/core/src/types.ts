export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mime: string; data: Uint8Array }
  | { type: 'audio'; mime: string; data: Uint8Array }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; content: ContentPart[] };

export type Role = 'system' | 'user' | 'assistant';
export type Message = { role: Role; content: ContentPart[] };

export const text = (value: string): ContentPart => ({ type: 'text', text: value });
export const image = (mime: string, data: Uint8Array): ContentPart => ({ type: 'image', mime, data });
export const audio = (mime: string, data: Uint8Array): ContentPart => ({ type: 'audio', mime, data });

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  prompt?: string;
  run(input: unknown, ctx: { signal?: AbortSignal }): Promise<ContentPart[]>;
}

export interface Usage {
  input?: number;
  output?: number;
  total?: number;
  contextWindow?: number;
}

export type StreamEvent =
  | ContentPart
  | { type: 'usage'; usage: Usage }
  | { type: 'reasoning'; text: string };

export interface Provider {
  stream(req: { model: string; messages: Message[]; tools: Tool[]; signal?: AbortSignal }): AsyncIterable<StreamEvent>;
}
