/**
 * Transport primitives: SSE / NDJSON readers + fetch-with-idle-timeout.
 *
 * Used by `createProvider` to drive the lower-level HTTP plumbing without
 * each adapter having to re-implement framing.
 */

export async function* readSSE(response: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!response.body) throw new Error('Response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) throw new Error('aborted');
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by blank lines.
      let idx: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of event.split('\n')) {
          if (line.startsWith('data:')) {
            yield line.slice(5).trim();
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* readNDJSON(response: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!response.body) throw new Error('Response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) throw new Error('aborted');
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield line;
      }
    }
    if (buffer.trim()) yield buffer.trim();
  } finally {
    reader.releaseLock();
  }
}

/**
 * Fetch with an idle timeout: aborts if no bytes are received from the
 * server for `timeoutMs` consecutive milliseconds.
 *
 * Returns the Response *and* a `resetIdle()` callback the caller invokes
 * each time it consumes a chunk so the timer slides forward.
 */
export async function fetchWithIdleTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; resetIdle: () => void; cancel: () => void }> {
  const ctl = new AbortController();
  const upstream = init.signal;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const armed = { value: true };
  const resetIdle = () => {
    if (!armed.value) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => ctl.abort(), timeoutMs);
  };
  const cancel = () => {
    armed.value = false;
    if (timer) clearTimeout(timer);
  };
  if (upstream) {
    if (upstream.aborted) ctl.abort();
    else upstream.addEventListener('abort', () => ctl.abort(), { once: true });
  }
  resetIdle();
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: ctl.signal });
  } catch (err) {
    // Cancel the idle timer so a failed fetch doesn't keep the event loop
    // alive for `timeoutMs` after the rejection has propagated.
    cancel();
    throw err;
  }
  resetIdle();
  return { response, resetIdle, cancel };
}
