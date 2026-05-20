export type Message = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_id?: string;
};
