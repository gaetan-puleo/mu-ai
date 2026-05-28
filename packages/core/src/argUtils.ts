/**
 * Parse a stringified JSON args payload from the LLM. Tools receive
 * `args: string` per the `Tool.execute` contract. Returns the parsed object
 * or throws — callers should let it propagate so `Tool.onError` can format
 * the message.
 */
export function parseArgs(args: string): Record<string, unknown> {
  if (!args || args.trim() === '') return {};
  const parsed = JSON.parse(args);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool arguments must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Normalize an unknown thrown value into a `Tool.onError` string. Avoids
 * double-prefixing when the incoming message already starts with "Error:".
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) return `Error: ${error.message}`;
  const str = String(error);
  return str.startsWith('Error:') ? str : `Error: ${str}`;
}
