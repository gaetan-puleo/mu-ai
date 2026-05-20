export type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: string) => string | Promise<string>;
  onError: (error: unknown) => string;
};

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
