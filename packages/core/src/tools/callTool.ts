import type { AfterToolData, AfterToolResult, BeforeToolData, BeforeToolResult } from '../types/Hook';
import type { Tool } from '../types/Tool';

export async function callTool(
  tool: Tool,
  args: string,
  hooks?: {
    beforeTool?: (data: BeforeToolData) => Promise<BeforeToolResult>;
    afterTool?: (data: AfterToolData) => Promise<AfterToolResult>;
  },
): Promise<string> {
  const beforeResult = await hooks?.beforeTool?.({ tool, args });
  if (beforeResult && 'block' in beforeResult) {
    return `Blocked: ${beforeResult.reason}`;
  }

  let result: string;
  try {
    result = await tool.execute(args);
  } catch (error) {
    try {
      result = tool.onError(error);
    } catch {
      // onError must never throw — fall back to a generic message so the
      // turn keeps a paired tool result instead of poisoning the runtime.
      const message = error instanceof Error ? error.message : String(error);
      result = `Error: ${tool.name} failed: ${message}`;
    }
  }

  const afterResult = await hooks?.afterTool?.({ tool, args, result });
  if (afterResult && 'result' in afterResult) {
    return afterResult.result;
  }

  return result;
}
