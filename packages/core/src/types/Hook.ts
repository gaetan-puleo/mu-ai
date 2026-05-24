import type { Tool } from './Tool';

export interface BeforeToolData {
  tool: Tool;
  args: string;
}

export interface AfterToolData {
  tool: Tool;
  result: string;
}

export type BeforeToolResult = undefined | { block: true; reason: string };
export type AfterToolResult = undefined | { result: string };

export type BeforeToolHook = (data: BeforeToolData) => Promise<BeforeToolResult>;
export type AfterToolHook = (data: AfterToolData) => Promise<AfterToolResult>;

export interface ToolHooks {
  beforeTool?: BeforeToolHook;
  afterTool?: AfterToolHook;
}
