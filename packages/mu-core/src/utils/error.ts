/**
 * Provider-agnostic error helpers.
 *
 * `enrichLLMError` rewrites the bare `"Connection error."` the OpenAI SDK
 * (and similar providers) emits with the configured baseUrl so operators
 * immediately know which endpoint is unreachable.
 *
 * `errorMessage` is a defensive extractor for unknown thrown values.
 */

export function enrichLLMError(raw: string, baseUrl: string): string {
  if (raw === 'Connection error.') {
    return `Connection error: cannot reach the LLM endpoint at ${baseUrl}. Check that the server is running and the URL is reachable.`;
  }
  return raw;
}

/** Extract the message text from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
