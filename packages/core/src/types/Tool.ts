export type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  systemPrompt?: string | (() => string | undefined | Promise<string | undefined>);
  execute: (args: string) => string | Promise<string>;
  onError: (error: unknown) => string;
};

export type Tools = Record<string, Tool>;

export type ToolCall = {
  type: 'tool_call';
  id: string;
  tool: string;
  args: string;
};

export type Response = {
  type: 'response';
  content: string;
};

export type Action = ToolCall | Response;

export type LLMResponseContextSlot = {
  id: number;
  n_ctx: number;
  is_processing: boolean;
};

export type LLMResponseContextProps = {
  n_ctx: number;
  total_slots: number;
  model_path: string;
  model_alias: string;
};

export type LLMResponseContext = {
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  timings?: Record<string, unknown>;
  props?: LLMResponseContextProps;
  slots?: LLMResponseContextSlot[];
  currentSlot?: LLMResponseContextSlot;
  raw?: Record<string, unknown>;
};

export type LLMResponse = {
  content?: string;
  tool_calls?: ToolCall[];
  reasoning?: string;
  context?: LLMResponseContext;
};

export type LLMStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'done'; response?: LLMResponse };
