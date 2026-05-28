import { parseArgs } from './argUtils';
import type { AfterToolData, AfterToolResult, BeforeToolData, BeforeToolResult } from './types/Hook';
import type { Tool, ToolContext } from './types/Tool';

/**
 * Invoke a tool against the wire-format JSON `args` string. The runtime calls
 * this once per `ToolCall`; we parse the JSON, run the hooks, and pipe a
 * `ToolContext` through so the tool can honor cancellation.
 *
 *   - If `args` isn't valid JSON, we call `tool.onError(parseError, ctx)`
 *     instead of `execute`. The transcript still gets a paired tool result.
 *   - If `execute` throws, same path: `tool.onError(error, ctx)`.
 *   - If `onError` also throws (or isn't defined), we fall back to a generic
 *     message so a misbehaving tool can't poison the runtime.
 */
export async function callTool(
  tool: Tool,
  args: string,
  ctx?: ToolContext,
  hooks?: {
    beforeTool?: (data: BeforeToolData) => Promise<BeforeToolResult>;
    afterTool?: (data: AfterToolData) => Promise<AfterToolResult>;
  },
): Promise<string> {
  const beforeResult = await hooks?.beforeTool?.({ tool, args });
  if (beforeResult && 'block' in beforeResult) {
    return `Blocked: ${beforeResult.reason}`;
  }

  let result: unknown;
  try {
    // Parse once at the runtime boundary so individual tools don't repeat
    // try/catch around JSON.parse. Empty/blank args parse to `{}`.
    const parsed = parseArgs(args);
    result = await tool.execute(parsed, ctx);
  } catch (error) {
    try {
      if (tool.onError) {
        result = await tool.onError(error, ctx);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        result = `Error: ${tool.name} failed: ${message}`;
      }
    } catch {
      // onError must never break the turn — fall back to a generic string
      // so the transcript stays paired with a tool result.
      const message = error instanceof Error ? error.message : String(error);
      result = `Error: ${tool.name} failed: ${message}`;
    }
  }

  // Tools default to `string` results but `Tool<TArgs, TResult>` allows
  // non-string returns. Wire format on `Message.tool` is still a string, so
  // serialize anything non-string here and surface JSON when needed.
  const resultStr = typeof result === 'string'
    ? result
    : result === undefined
    ? ''
    : safeStringify(result);

  const afterResult = await hooks?.afterTool?.({ tool, args, result: resultStr });
  if (afterResult && 'result' in afterResult) {
    return afterResult.result;
  }

  return resultStr;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
