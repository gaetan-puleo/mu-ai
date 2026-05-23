import type { ToolCall } from './Tool';

export type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'reasoning';
  content: string;
  tool_id?: string;
  tool_calls?: ToolCall[];
};
