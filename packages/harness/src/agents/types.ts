export type ToolDecision = 'allow' | 'ask' | 'deny';

export type GrantValue = ToolDecision | Record<string, ToolDecision>;

export type ToolGrants = string[] | Record<string, GrantValue>;

export interface Agent {
  name: string;
  description: string;
  prompt: string;
  tools?: ToolGrants;
  model?: string;
  color?: string;
  extends?: string;
}
