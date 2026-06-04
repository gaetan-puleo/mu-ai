export type ToolDecision = 'allow' | 'ask' | 'deny';

export type ToolGrants = string[] | Record<string, ToolDecision>;

export interface Agent {
  name: string;
  description: string;
  prompt: string;
  tools?: ToolGrants;
  model?: string;
  color?: string;
  extends?: string;
}
