export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mime: string; data: Uint8Array }
  | { type: 'audio'; mime: string; data: Uint8Array }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; content: ContentPart[] };

export type Role = 'system' | 'user' | 'assistant' | 'tool';
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

/** Non-text input modalities a model accepts. */
export interface ModelModalities {
  vision: boolean;
  audio: boolean;
}

export interface Provider {
  stream(
    req: {
      model: string;
      messages: Message[];
      tools: Tool[];
      signal?: AbortSignal;
      /** Per-turn extra chat-template kwargs (e.g. `{ enable_thinking: false }`). A
       * provider wrapper can set this for a single turn; merged over any provider-level
       * default. Providers that don't support it ignore it. */
      chatTemplateKwargs?: Record<string, unknown>;
    },
  ): AsyncIterable<StreamEvent>;
  /**
   * Probe a model's input modalities. MAY load the model (e.g. a llama.cpp `/props`
   * fetch) — call it on model selection, not on every turn. Optional: providers that
   * can't introspect modalities simply omit it.
   */
  capabilities?(model: string): Promise<ModelModalities | undefined>;
  /** Exact token count of `text` via the model's own tokenizer, when the provider supports it. */
  countTokens?(text: string, model: string): Promise<number | undefined>;
  /** The model's context window in tokens, when the provider can report it. */
  contextWindow?(model: string): Promise<number | undefined>;
}
