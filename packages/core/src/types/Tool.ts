export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  systemPrompt?: string | (() => string | undefined | Promise<string | undefined>);
  execute: (args: string) => string | Promise<string>;
  onError: (error: unknown) => string;
}

export type Tools = Record<string, Tool>;

export interface ToolCall {
  type: 'tool_call';
  id: string;
  tool: string;
  args: string;
}

export type ContextPartKind =
  | 'system'
  | 'tools'
  | 'messages'
  | 'tool_results'
  | 'skills'
  | 'mcp'
  | 'other';

export interface ContextPart {
  kind: ContextPartKind;
  label: string;
  tokens: number;
  estimated: boolean;
}

export interface ContextMap {
  model?: string;
  usedTokens?: number;
  windowTokens?: number;
  estimated: boolean;
  parts: ContextPart[];
}

export interface LLMResponseContext {
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  contextMap?: ContextMap;
}

export interface LLMResponse {
  content?: string;
  tool_calls?: ToolCall[];
  reasoning?: string;
  context?: LLMResponseContext;
}

export type LLMStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'done'; response?: LLMResponse };
