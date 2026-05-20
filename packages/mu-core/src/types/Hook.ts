import type { Tool } from './Tool';

export type BeforeToolData = {
  tool: Tool;
  args: string;
};

export type AfterToolData = {
  tool: Tool;
  result: string;
};

export type BeforeToolResult = void | { block: true; reason: string };
export type AfterToolResult = void | { result: string };

export type BeforeToolHook = (data: BeforeToolData) => Promise<BeforeToolResult>;
export type AfterToolHook = (data: AfterToolData) => Promise<AfterToolResult>;

export type ToolHooks = {
  beforeTool?: BeforeToolHook;
  afterTool?: AfterToolHook;
};
