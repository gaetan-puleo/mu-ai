import type { Tool } from '../types/Tool';
import type { BeforeToolData, AfterToolData, BeforeToolResult, AfterToolResult } from '../types/Hook';

export async function callTool(
  tool: Tool,
  args: string,
  hooks?: { beforeTool?: (data: BeforeToolData) => Promise<BeforeToolResult>; afterTool?: (data: AfterToolData) => Promise<AfterToolResult> },
): Promise<string> {
  const beforeResult = await hooks?.beforeTool?.({ tool, args });
  if (beforeResult && 'block' in beforeResult) {
    throw new Error(beforeResult.reason);
  }

  let result: string;
  try {
    result = await tool.execute(args);
  } catch (error) {
    result = tool.onError(error);
  }

  const afterResult = await hooks?.afterTool?.({ tool, result });
  if (afterResult && 'result' in afterResult) {
    return afterResult.result;
  }

  return result;
}
